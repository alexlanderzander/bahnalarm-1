"""
Hybrid Dataset for HNSF Training

Generates and loads multi-modal spatial data including:
- 3D positions
- Orientation
- Acoustic STFT
- RF RSSI
"""

import torch
from torch.utils.data import Dataset
import numpy as np
from typing import Dict, List, Tuple, Optional
from pathlib import Path
import json


class HybridSpatialDataset(Dataset):
    """
    Dataset for Hybrid Neural Spatial Field training.

    Each sample contains:
        - listener_pos: 3D position [x, y, z]
        - emitter_pos: 3D position [x, y, z]
        - orientation: [θ azimuth, φ elevation]
        - channel: 0 (left/mono) or 1 (right)
        - stft_mag: STFT magnitude
        - stft_if: Instantaneous frequency
        - rf_rssi: BLE RSSI vector (optional)
    """

    def __init__(
        self,
        data_dir: Optional[str] = None,
        samples: Optional[List[Dict]] = None,
        normalize: bool = True
    ):
        self.normalize = normalize
        self.samples = samples if samples else []

        if data_dir:
            self._load_from_dir(data_dir)

        if self.normalize and len(self.samples) > 0:
            self._compute_stats()

    def _load_from_dir(self, data_dir: str):
        """Load samples from directory."""
        data_path = Path(data_dir)
        for f in data_path.glob("*.npz"):
            data = np.load(f)
            self.samples.append({k: data[k] for k in data.files})

    def _compute_stats(self):
        """Compute normalization statistics."""
        all_mags = []
        for s in self.samples:
            if 'stft_mag' in s:
                all_mags.append(np.array(s['stft_mag']).flatten())

        if all_mags:
            all_mags = np.concatenate(all_mags)
            self.mag_mean = float(np.mean(all_mags))
            self.mag_std = float(np.std(all_mags))
        else:
            self.mag_mean = 0.0
            self.mag_std = 1.0

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        sample = self.samples[idx]

        result = {
            'listener_pos': torch.tensor(sample['listener_pos'], dtype=torch.float32),
            'emitter_pos': torch.tensor(sample['emitter_pos'], dtype=torch.float32),
            'orientation': torch.tensor(sample.get('orientation', [0.0, 0.0]), dtype=torch.float32),
            'channel': torch.tensor(sample.get('channel', 0), dtype=torch.long),
        }

        if 'stft_mag' in sample:
            stft_mag = torch.tensor(sample['stft_mag'], dtype=torch.float32)
            stft_if = torch.tensor(sample.get('stft_if', np.zeros_like(sample['stft_mag'])), dtype=torch.float32)

            if self.normalize:
                stft_mag = (stft_mag - self.mag_mean) / (3.0 * self.mag_std + 1e-8)

            result['stft_mag'] = stft_mag
            result['stft_if'] = stft_if

        if 'rf_rssi' in sample:
            result['rf_rssi'] = torch.tensor(sample['rf_rssi'], dtype=torch.float32)

        return result


class HybridBatchSampler:
    """
    Batch sampler for hybrid training.

    Samples spatial positions and (t, f) coordinates,
    with optional RF data augmentation.
    """

    def __init__(
        self,
        dataset: HybridSpatialDataset,
        batch_size: int = 20,
        tf_samples: int = 500,
        include_rf: bool = True,
        num_beacons: int = 10
    ):
        self.dataset = dataset
        self.batch_size = batch_size
        self.tf_samples = tf_samples
        self.include_rf = include_rf
        self.num_beacons = num_beacons

    def sample_batch(self) -> Dict[str, torch.Tensor]:
        """Sample a training batch."""
        indices = np.random.choice(len(self.dataset), self.batch_size, replace=True)

        all_listener = []
        all_emitter = []
        all_orient = []
        all_channel = []
        all_time = []
        all_freq = []
        all_mag = []
        all_rf = []

        for idx in indices:
            sample = self.dataset[idx]

            has_acoustic = 'stft_mag' in sample

            if has_acoustic:
                stft_mag = sample['stft_mag']
                T, F = stft_mag.shape

                # Sample (t, f) coordinates
                t_idx = np.random.randint(0, T, self.tf_samples)
                f_idx = np.random.randint(0, F, self.tf_samples)

                t_norm = torch.tensor(2.0 * t_idx / (T - 1) - 1.0, dtype=torch.float32)
                f_norm = torch.tensor(2.0 * f_idx / (F - 1) - 1.0, dtype=torch.float32)
                mag_vals = stft_mag[t_idx, f_idx]
            else:
                # Use dummy values if no acoustic
                t_norm = torch.zeros(self.tf_samples)
                f_norm = torch.zeros(self.tf_samples)
                mag_vals = torch.zeros(self.tf_samples)

            # Expand spatial for each (t, f) sample
            listener = sample['listener_pos'].unsqueeze(0).expand(self.tf_samples, -1)
            emitter = sample['emitter_pos'].unsqueeze(0).expand(self.tf_samples, -1)
            orient = sample['orientation'].unsqueeze(0).expand(self.tf_samples, -1)
            channel = sample['channel'].expand(self.tf_samples)

            all_listener.append(listener)
            all_emitter.append(emitter)
            all_orient.append(orient)
            all_channel.append(channel)
            all_time.append(t_norm)
            all_freq.append(f_norm)
            all_mag.append(mag_vals)

            # RF data
            if 'rf_rssi' in sample:
                rf = sample['rf_rssi'].unsqueeze(0).expand(self.tf_samples, -1)
            elif self.include_rf:
                # Generate synthetic RF
                rf = self._generate_synthetic_rf(sample['listener_pos'], self.tf_samples)
            else:
                rf = torch.zeros(self.tf_samples, self.num_beacons)
            all_rf.append(rf)

        return {
            'listener_pos': torch.cat(all_listener, dim=0),
            'emitter_pos': torch.cat(all_emitter, dim=0),
            'orientation': torch.cat(all_orient, dim=0),
            'channel': torch.cat(all_channel, dim=0),
            'time': torch.cat(all_time, dim=0),
            'freq': torch.cat(all_freq, dim=0),
            'target_mag': torch.cat(all_mag, dim=0),
            'rf_rssi': torch.cat(all_rf, dim=0)
        }

    def _generate_synthetic_rf(self, pos: torch.Tensor, n_samples: int) -> torch.Tensor:
        """Generate synthetic RF based on position."""
        # Fixed beacon positions
        beacon_angles = torch.linspace(0, 2 * np.pi, self.num_beacons + 1)[:-1]
        beacon_pos = torch.stack([
            4 * torch.cos(beacon_angles),
            4 * torch.sin(beacon_angles),
            torch.zeros_like(beacon_angles)
        ], dim=-1)

        # Distance to beacons
        pos_3d = pos if pos.dim() == 1 else pos[:3]
        distances = torch.norm(beacon_pos - pos_3d, dim=-1)

        # RSSI from distance
        rssi = -40 - 20 * torch.log10(distances.clamp(min=0.1))
        rssi = rssi + torch.randn_like(rssi) * 2
        rssi = rssi.clamp(-100, -30)

        return rssi.unsqueeze(0).expand(n_samples, -1)


def create_synthetic_hybrid_dataset(
    num_samples: int = 200,
    stft_size: Tuple[int, int] = (64, 32),
    num_beacons: int = 10,
    scene_bounds: Tuple[float, float] = (-5.0, 5.0)
) -> HybridSpatialDataset:
    """
    Create synthetic dataset for hybrid model testing.
    """
    samples = []
    T, F = stft_size

    for _ in range(num_samples):
        # Random 3D positions
        listener = np.random.uniform(scene_bounds[0], scene_bounds[1], 3)
        listener[2] = np.random.uniform(-1, 1)  # Smaller Z range

        emitter = np.random.uniform(scene_bounds[0], scene_bounds[1], 3)
        emitter[2] = np.random.uniform(-1, 1)

        # Random orientation
        theta = np.random.uniform(-np.pi, np.pi)
        phi = np.random.uniform(-np.pi/4, np.pi/4)

        # Random channel
        channel = np.random.randint(0, 2)

        # Distance for acoustic
        distance = np.linalg.norm(listener - emitter)

        # Synthetic STFT
        t = np.linspace(0, 1, T)
        f = np.linspace(0, 1, F)
        t_grid, f_grid = np.meshgrid(t, f, indexing='ij')

        decay = np.exp(-distance / 2) * np.exp(-t_grid * 3)
        freq_response = np.exp(-(f_grid - 0.3) ** 2 / 0.1)
        stft_mag = np.log(decay * freq_response + 1e-8)
        stft_mag += np.random.randn(*stft_mag.shape) * 0.1

        # Synthetic RF
        beacon_angles = np.linspace(0, 2 * np.pi, num_beacons, endpoint=False)
        beacon_pos = np.stack([
            4 * np.cos(beacon_angles),
            4 * np.sin(beacon_angles),
            np.zeros(num_beacons)
        ], axis=-1)

        distances = np.linalg.norm(beacon_pos - listener, axis=-1)
        rf_rssi = -40 - 20 * np.log10(np.maximum(distances, 0.1))
        rf_rssi += np.random.randn(num_beacons) * 3
        rf_rssi = np.clip(rf_rssi, -100, -30)

        samples.append({
            'listener_pos': listener.astype(np.float32),
            'emitter_pos': emitter.astype(np.float32),
            'orientation': np.array([theta, phi], dtype=np.float32),
            'channel': int(channel),
            'stft_mag': stft_mag.astype(np.float32),
            'stft_if': np.zeros_like(stft_mag, dtype=np.float32),
            'rf_rssi': rf_rssi.astype(np.float32)
        })

    return HybridSpatialDataset(samples=samples, normalize=True)


def load_real_hybrid_dataset(
    data_dir: str,
    target_stft_size: Tuple[int, int] = (36, 256),
    num_beacons: int = 16
) -> HybridSpatialDataset:
    """
    Load real collected data from NPZ files.

    Args:
        data_dir: Path to training_data directory
        target_stft_size: Target STFT size (will resize if different)
        num_beacons: Expected number of RF beacons

    Returns:
        HybridSpatialDataset with real data
    """
    samples = []
    data_path = Path(data_dir)

    # Find all NPZ files recursively
    npz_files = list(data_path.glob("**/*.npz"))
    print(f"Found {len(npz_files)} NPZ files in {data_dir}")

    target_T, target_F = target_stft_size

    for npz_file in npz_files:
        try:
            data = np.load(npz_file)

            # Extract listener position (3D or pad to 3D)
            listener_pos = np.array(data['listener_pos'], dtype=np.float32)
            if len(listener_pos) < 3:
                listener_pos = np.pad(listener_pos, (0, 3 - len(listener_pos)))

            # Emitter position (same as listener for self-echo)
            emitter_pos = np.array(data['emitter_pos'], dtype=np.float32)
            if len(emitter_pos) < 3:
                emitter_pos = np.pad(emitter_pos, (0, 3 - len(emitter_pos)))

            # Orientation
            orientation = np.array(data.get('orientation', [0.0, 0.0]), dtype=np.float32)
            if len(orientation) < 2:
                orientation = np.pad(orientation, (0, 2 - len(orientation)))

            # Channel
            channel = int(data.get('channel', 0))

            # STFT magnitude - resize to target size if needed
            stft_mag = np.array(data['stft_mag'], dtype=np.float32)
            if stft_mag.shape != target_stft_size:
                # Resize using simple interpolation
                from scipy.ndimage import zoom
                zoom_factors = (target_T / stft_mag.shape[0], target_F / stft_mag.shape[1])
                stft_mag = zoom(stft_mag, zoom_factors, order=1)

            # STFT instantaneous frequency
            stft_if = np.array(data.get('stft_if', np.zeros_like(stft_mag)), dtype=np.float32)
            if stft_if.shape != target_stft_size:
                from scipy.ndimage import zoom
                zoom_factors = (target_T / stft_if.shape[0], target_F / stft_if.shape[1])
                stft_if = zoom(stft_if, zoom_factors, order=1)

            # RF RSSI - pad/truncate to num_beacons
            rf_rssi = np.array(data.get('rf_rssi', [-100] * num_beacons), dtype=np.float32)
            if len(rf_rssi) < num_beacons:
                rf_rssi = np.pad(rf_rssi, (0, num_beacons - len(rf_rssi)), constant_values=-100)
            elif len(rf_rssi) > num_beacons:
                rf_rssi = rf_rssi[:num_beacons]

            samples.append({
                'listener_pos': listener_pos,
                'emitter_pos': emitter_pos,
                'orientation': orientation,
                'channel': channel,
                'stft_mag': stft_mag,
                'stft_if': stft_if,
                'rf_rssi': rf_rssi
            })

        except Exception as e:
            print(f"Warning: Could not load {npz_file}: {e}")
            continue

    print(f"Loaded {len(samples)} valid samples")
    return HybridSpatialDataset(samples=samples, normalize=True)
