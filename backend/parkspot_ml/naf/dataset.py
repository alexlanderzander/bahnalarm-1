"""
NAF Dataset and Data Loading

Handles loading and preprocessing of impulse response data
for training Neural Acoustic Fields.
"""

import torch
from torch.utils.data import Dataset, DataLoader
import numpy as np
from typing import Dict, List, Tuple, Optional
import json
from pathlib import Path


class ImpulseResponseDataset(Dataset):
    """
    Dataset for NAF training.

    Each sample contains:
        - Listener position (x, y)
        - Emitter position (x, y)
        - STFT magnitude (log-scale)
        - STFT instantaneous frequency (phase derivative)

    Args:
        data_dir: Directory containing impulse response data
        normalize: Whether to normalize spectrograms
        max_samples: Maximum number of samples to load
    """

    def __init__(
        self,
        data_dir: Optional[str] = None,
        samples: Optional[List[Dict]] = None,
        normalize: bool = True,
        max_samples: Optional[int] = None
    ):
        self.normalize = normalize
        self.samples = []

        if samples is not None:
            self.samples = samples[:max_samples] if max_samples else samples
        elif data_dir is not None:
            self._load_from_dir(data_dir, max_samples)

        # Compute normalization stats if needed
        if self.normalize and len(self.samples) > 0:
            self._compute_stats()

    def _load_from_dir(self, data_dir: str, max_samples: Optional[int]):
        """Load samples from directory of JSON/NPZ files."""
        data_path = Path(data_dir)

        # Support multiple formats
        files = list(data_path.glob("*.json")) + list(data_path.glob("*.npz"))

        for f in files[:max_samples] if max_samples else files:
            if f.suffix == ".json":
                with open(f) as fp:
                    sample = json.load(fp)
                    self.samples.append(sample)
            elif f.suffix == ".npz":
                data = np.load(f)
                sample = {
                    'listener_pos': data['listener_pos'],
                    'emitter_pos': data['emitter_pos'],
                    'stft_mag': data['stft_mag'],
                    'stft_if': data['stft_if']
                }
                self.samples.append(sample)

    def _compute_stats(self):
        """Compute mean and std for normalization."""
        all_mags = []
        all_ifs = []

        for sample in self.samples:
            if isinstance(sample['stft_mag'], np.ndarray):
                all_mags.append(sample['stft_mag'].flatten())
                all_ifs.append(sample['stft_if'].flatten())
            else:
                all_mags.append(np.array(sample['stft_mag']).flatten())
                all_ifs.append(np.array(sample['stft_if']).flatten())

        all_mags = np.concatenate(all_mags)
        all_ifs = np.concatenate(all_ifs)

        self.mag_mean = float(np.mean(all_mags))
        self.mag_std = float(np.std(all_mags))
        self.if_mean = float(np.mean(all_ifs))
        self.if_std = float(np.std(all_ifs))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        sample = self.samples[idx]

        # Convert to tensors
        listener_pos = torch.tensor(sample['listener_pos'], dtype=torch.float32)
        emitter_pos = torch.tensor(sample['emitter_pos'], dtype=torch.float32)
        stft_mag = torch.tensor(sample['stft_mag'], dtype=torch.float32)
        stft_if = torch.tensor(sample['stft_if'], dtype=torch.float32)

        # Normalize (paper: divide by 3*std after centering)
        if self.normalize:
            stft_mag = (stft_mag - self.mag_mean) / (3.0 * self.mag_std + 1e-8)
            stft_if = stft_if / (3.0 * self.if_std + 1e-8)

        return {
            'listener_pos': listener_pos,
            'emitter_pos': emitter_pos,
            'stft_mag': stft_mag,
            'stft_if': stft_if
        }


class NAFBatchSampler:
    """
    Custom batch sampler for NAF training.

    Following the paper:
    - Sample 20 impulse responses per batch
    - Randomly select 2000 (t, f) pairs within each spectrogram
    """

    def __init__(
        self,
        dataset: ImpulseResponseDataset,
        batch_size: int = 20,
        tf_samples: int = 2000
    ):
        self.dataset = dataset
        self.batch_size = batch_size
        self.tf_samples = tf_samples

    def sample_batch(self) -> Dict[str, torch.Tensor]:
        """
        Sample a training batch.

        Returns dict with:
            listener_pos: [B * tf_samples, 2]
            emitter_pos: [B * tf_samples, 2]
            time: [B * tf_samples]
            freq: [B * tf_samples]
            target_mag: [B * tf_samples]
            target_if: [B * tf_samples]
        """
        # Sample random impulse responses
        indices = np.random.choice(len(self.dataset), self.batch_size, replace=True)

        all_listener = []
        all_emitter = []
        all_time = []
        all_freq = []
        all_mag = []
        all_if = []

        for idx in indices:
            sample = self.dataset[idx]

            stft_mag = sample['stft_mag']  # [T, F]
            stft_if = sample['stft_if']
            T, F = stft_mag.shape

            # Sample random (t, f) coordinates
            t_indices = np.random.randint(0, T, self.tf_samples)
            f_indices = np.random.randint(0, F, self.tf_samples)

            # Normalize to [-1, 1]
            t_norm = 2.0 * t_indices / (T - 1) - 1.0
            f_norm = 2.0 * f_indices / (F - 1) - 1.0

            # Expand positions for each (t, f) sample
            listener = sample['listener_pos'].unsqueeze(0).expand(self.tf_samples, -1)
            emitter = sample['emitter_pos'].unsqueeze(0).expand(self.tf_samples, -1)

            # Get target values at sampled coordinates
            mag_values = stft_mag[t_indices, f_indices]
            if_values = stft_if[t_indices, f_indices]

            all_listener.append(listener)
            all_emitter.append(emitter)
            all_time.append(torch.tensor(t_norm, dtype=torch.float32))
            all_freq.append(torch.tensor(f_norm, dtype=torch.float32))
            all_mag.append(mag_values)
            all_if.append(if_values)

        return {
            'listener_pos': torch.cat(all_listener, dim=0),
            'emitter_pos': torch.cat(all_emitter, dim=0),
            'time': torch.cat(all_time, dim=0),
            'freq': torch.cat(all_freq, dim=0),
            'target_mag': torch.cat(all_mag, dim=0),
            'target_if': torch.cat(all_if, dim=0)
        }


def create_synthetic_dataset(
    num_samples: int = 100,
    stft_size: Tuple[int, int] = (128, 64),
    scene_bounds: Tuple[float, float] = (-5.0, 5.0)
) -> ImpulseResponseDataset:
    """
    Create synthetic dataset for testing.

    Generates fake impulse responses with distance-based decay
    for initial model testing.
    """
    samples = []
    T, F = stft_size

    for _ in range(num_samples):
        # Random positions in scene
        listener = np.random.uniform(scene_bounds[0], scene_bounds[1], 2)
        emitter = np.random.uniform(scene_bounds[0], scene_bounds[1], 2)

        # Distance between listener and emitter
        distance = np.linalg.norm(listener - emitter)

        # Synthetic STFT: decay with distance and time
        t = np.linspace(0, 1, T)
        f = np.linspace(0, 1, F)
        t_grid, f_grid = np.meshgrid(t, f, indexing='ij')

        # Simple model: exponential decay with distance and time
        decay = np.exp(-distance / 2) * np.exp(-t_grid * 3)

        # Add some frequency variation
        freq_response = np.exp(-(f_grid - 0.3) ** 2 / 0.1)

        stft_mag = np.log(decay * freq_response + 1e-8)
        stft_if = np.zeros_like(stft_mag)  # Simplified: no phase for synthetic

        # Add noise
        stft_mag += np.random.randn(*stft_mag.shape) * 0.1

        samples.append({
            'listener_pos': listener.astype(np.float32),
            'emitter_pos': emitter.astype(np.float32),
            'stft_mag': stft_mag.astype(np.float32),
            'stft_if': stft_if.astype(np.float32)
        })

    return ImpulseResponseDataset(samples=samples, normalize=True)
