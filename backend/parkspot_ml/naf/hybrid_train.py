"""
Hybrid Model Training Pipeline

Training loop for Hybrid Neural Spatial Fields (HNSF).
"""

import torch
import torch.nn as nn
import torch.optim as optim
from typing import Dict, Optional
import time
from pathlib import Path

from .hybrid_model import HybridSpatialField, create_hybrid_model
from .hybrid_dataset import HybridSpatialDataset, HybridBatchSampler, create_synthetic_hybrid_dataset, load_real_hybrid_dataset


class HybridTrainer:
    """
    Trainer for Hybrid Neural Spatial Fields.

    Handles multi-modal training with acoustic + RF inputs.
    """

    def __init__(
        self,
        model: HybridSpatialField,
        dataset: HybridSpatialDataset,
        lr: float = 5e-4,
        alpha_phase: float = 0.5,
        alpha_structure: float = 0.1,
        coord_noise: float = 0.05,
        device: str = 'cpu'
    ):
        self.model = model.to(device)
        self.dataset = dataset
        self.device = device
        self.alpha_phase = alpha_phase
        self.alpha_structure = alpha_structure
        self.coord_noise = coord_noise

        self.optimizer = optim.Adam(model.parameters(), lr=lr)
        self.sampler = HybridBatchSampler(
            dataset,
            batch_size=16,
            tf_samples=500,
            include_rf=True
        )

        self.epoch = 0
        self.step = 0
        self.best_loss = float('inf')

    def train_step(self) -> Dict[str, float]:
        """Single training step."""
        self.optimizer.zero_grad()

        batch = self.sampler.sample_batch()

        # Move to device
        listener_pos = batch['listener_pos'].to(self.device)
        emitter_pos = batch['emitter_pos'].to(self.device)
        orientation = batch['orientation'].to(self.device)
        channel = batch['channel'].to(self.device)
        time_coord = batch['time'].to(self.device)
        freq_coord = batch['freq'].to(self.device)
        target_mag = batch['target_mag'].to(self.device)
        rf_rssi = batch['rf_rssi'].to(self.device)

        # Add coordinate noise
        if self.coord_noise > 0:
            listener_pos = listener_pos + torch.randn_like(listener_pos) * self.coord_noise
            emitter_pos = emitter_pos + torch.randn_like(emitter_pos) * self.coord_noise

        # Forward pass
        outputs = self.model(
            listener_pos=listener_pos,
            emitter_pos=emitter_pos,
            orientation=orientation,
            channel=channel,
            time=time_coord,
            freq=freq_coord,
            acoustic_mag=target_mag,  # Use target for encoder training
            rf_rssi=rf_rssi
        )

        # Losses
        mag_loss = nn.functional.mse_loss(outputs['loudness'].squeeze(), target_mag)

        # Structure loss: use distance to emitter as pseudo-target
        distance = torch.norm(listener_pos - emitter_pos, dim=-1, keepdim=True)
        struct_target = torch.cat([distance, distance, distance, distance], dim=-1)
        struct_loss = nn.functional.mse_loss(outputs['structure'], struct_target)

        total_loss = mag_loss + self.alpha_structure * struct_loss

        # Backward
        total_loss.backward()
        self.optimizer.step()
        self.step += 1

        return {
            'loss': total_loss.item(),
            'mag_loss': mag_loss.item(),
            'struct_loss': struct_loss.item()
        }

    def train_epoch(self, steps_per_epoch: int = 50) -> Dict[str, float]:
        """Train one epoch."""
        self.model.train()

        totals = {'loss': 0, 'mag_loss': 0, 'struct_loss': 0}

        for _ in range(steps_per_epoch):
            metrics = self.train_step()
            for k, v in metrics.items():
                totals[k] += v

        self.epoch += 1
        return {k: v / steps_per_epoch for k, v in totals.items()}

    def train(
        self,
        epochs: int = 100,
        steps_per_epoch: int = 50,
        save_dir: Optional[str] = None,
        save_every: int = 10
    ) -> Dict[str, list]:
        """Full training loop."""
        history = {'loss': [], 'mag_loss': [], 'struct_loss': []}

        save_path = Path(save_dir) if save_dir else None
        if save_path:
            save_path.mkdir(parents=True, exist_ok=True)

        print(f"Starting HNSF training for {epochs} epochs...")
        start = time.time()

        for epoch in range(epochs):
            epoch_start = time.time()
            metrics = self.train_epoch(steps_per_epoch)
            epoch_time = time.time() - epoch_start

            for k, v in metrics.items():
                history[k].append(v)

            print(f"Epoch {epoch+1}/{epochs} - "
                  f"Loss: {metrics['loss']:.4f} "
                  f"(mag: {metrics['mag_loss']:.4f}, struct: {metrics['struct_loss']:.4f}) - "
                  f"Time: {epoch_time:.1f}s")

            if save_path and (epoch + 1) % save_every == 0:
                self.save_checkpoint(save_path / f"hybrid_epoch_{epoch+1}.pt")

            if metrics['loss'] < self.best_loss:
                self.best_loss = metrics['loss']
                if save_path:
                    self.save_checkpoint(save_path / "hybrid_best.pt")

        print(f"Training complete in {(time.time() - start)/60:.1f} minutes")
        return history

    def save_checkpoint(self, path: str):
        torch.save({
            'epoch': self.epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'best_loss': self.best_loss
        }, path)
        print(f"Saved: {path}")

    def load_checkpoint(self, path: str):
        ckpt = torch.load(path, map_location=self.device)
        self.model.load_state_dict(ckpt['model_state_dict'])
        self.optimizer.load_state_dict(ckpt['optimizer_state_dict'])
        self.epoch = ckpt['epoch']
        self.best_loss = ckpt['best_loss']


def train_hybrid(
    epochs: int = 100,
    device: str = 'cpu',
    save_dir: str = './naf_checkpoints',
    data_dir: str = None
) -> HybridSpatialField:
    """Train hybrid model on real or synthetic data."""

    if data_dir:
        print(f"Loading REAL data from {data_dir}...")
        dataset = load_real_hybrid_dataset(data_dir)
    else:
        print("Creating synthetic hybrid dataset...")
        dataset = create_synthetic_hybrid_dataset(num_samples=300)
    print(f"Dataset: {len(dataset)} samples")

    print("Creating hybrid model...")
    model = create_hybrid_model(
        grid_size=16,
        hidden_dim=512,
        num_layers=8,
        device=device
    )

    num_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {num_params:,}")

    trainer = HybridTrainer(
        model=model,
        dataset=dataset,
        lr=5e-4,
        device=device
    )

    trainer.train(
        epochs=epochs,
        steps_per_epoch=50,
        save_dir=save_dir
    )

    return model


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=str, default=None,
                        help='Path to real training data (NPZ files)')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--device', type=str, default='auto')
    args = parser.parse_args()

    if args.device == 'auto':
        if torch.backends.mps.is_available():
            device = 'mps'
        elif torch.cuda.is_available():
            device = 'cuda'
        else:
            device = 'cpu'
    else:
        device = args.device

    print(f"Using device: {device}")

    model = train_hybrid(
        epochs=args.epochs,
        device=device,
        save_dir='./naf_checkpoints',
        data_dir=args.data_dir
    )

    print("Hybrid training complete!")
