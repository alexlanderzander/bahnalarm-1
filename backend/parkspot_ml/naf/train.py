"""
NAF Training Pipeline

Training loop and utilities for Neural Acoustic Fields.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.tensorboard import SummaryWriter
from typing import Optional, Dict, Tuple
import time
from pathlib import Path
import json

from .model import NeuralAcousticField, create_naf_model
from .dataset import ImpulseResponseDataset, NAFBatchSampler, create_synthetic_dataset


class NAFTrainer:
    """
    Trainer for Neural Acoustic Fields.

    Following paper:
        - 200 epochs
        - lr = 5e-4 for network and grid
        - MSE loss on magnitude + α * MSE on instantaneous frequency
        - Adam optimizer
        - Add noise N(0, 0.1) to coordinates during training

    Args:
        model: NAF model
        dataset: Training dataset
        lr: Learning rate
        alpha: Weight for phase loss
        coord_noise: Std of noise added to coordinates
        device: Training device
    """

    def __init__(
        self,
        model: NeuralAcousticField,
        dataset: ImpulseResponseDataset,
        lr: float = 5e-4,
        alpha: float = 1.0,
        coord_noise: float = 0.1,
        device: str = 'cpu',
        log_dir: Optional[str] = None
    ):
        self.model = model.to(device)
        self.dataset = dataset
        self.device = device
        self.alpha = alpha
        self.coord_noise = coord_noise

        # Optimizer
        self.optimizer = optim.Adam(model.parameters(), lr=lr)

        # Batch sampler
        self.sampler = NAFBatchSampler(dataset, batch_size=20, tf_samples=2000)

        # Logging
        self.log_dir = Path(log_dir) if log_dir else None
        self.writer = SummaryWriter(log_dir) if log_dir else None

        # Training state
        self.epoch = 0
        self.step = 0
        self.best_loss = float('inf')

    def train_epoch(self, steps_per_epoch: int = 100) -> Dict[str, float]:
        """Train for one epoch."""
        self.model.train()

        epoch_loss = 0
        epoch_mag_loss = 0
        epoch_if_loss = 0

        for _ in range(steps_per_epoch):
            loss, mag_loss, if_loss = self.train_step()
            epoch_loss += loss
            epoch_mag_loss += mag_loss
            epoch_if_loss += if_loss
            self.step += 1

        self.epoch += 1

        return {
            'loss': epoch_loss / steps_per_epoch,
            'mag_loss': epoch_mag_loss / steps_per_epoch,
            'if_loss': epoch_if_loss / steps_per_epoch
        }

    def train_step(self) -> Tuple[float, float, float]:
        """Single training step."""
        self.optimizer.zero_grad()

        # Sample batch
        batch = self.sampler.sample_batch()

        # Move to device
        listener_pos = batch['listener_pos'].to(self.device)
        emitter_pos = batch['emitter_pos'].to(self.device)
        time = batch['time'].to(self.device)
        freq = batch['freq'].to(self.device)
        target_mag = batch['target_mag'].to(self.device)
        target_if = batch['target_if'].to(self.device)

        # Add noise to coordinates (paper: prevents degenerate solutions)
        if self.coord_noise > 0:
            listener_pos = listener_pos + torch.randn_like(listener_pos) * self.coord_noise
            emitter_pos = emitter_pos + torch.randn_like(emitter_pos) * self.coord_noise

        # Forward pass
        pred_mag, pred_if = self.model(listener_pos, emitter_pos, time, freq)

        # Losses
        mag_loss = nn.functional.mse_loss(pred_mag.squeeze(), target_mag)
        if_loss = nn.functional.mse_loss(pred_if.squeeze(), target_if)

        total_loss = mag_loss + self.alpha * if_loss

        # Backward pass
        total_loss.backward()
        self.optimizer.step()

        # Log
        if self.writer:
            self.writer.add_scalar('train/loss', total_loss.item(), self.step)
            self.writer.add_scalar('train/mag_loss', mag_loss.item(), self.step)
            self.writer.add_scalar('train/if_loss', if_loss.item(), self.step)

        return total_loss.item(), mag_loss.item(), if_loss.item()

    def train(
        self,
        epochs: int = 200,
        steps_per_epoch: int = 100,
        save_dir: Optional[str] = None,
        save_every: int = 10
    ) -> Dict[str, list]:
        """
        Full training loop.

        Args:
            epochs: Number of epochs
            steps_per_epoch: Steps per epoch
            save_dir: Directory to save checkpoints
            save_every: Save checkpoint every N epochs

        Returns:
            Training history
        """
        history = {'loss': [], 'mag_loss': [], 'if_loss': []}

        save_path = Path(save_dir) if save_dir else None
        if save_path:
            save_path.mkdir(parents=True, exist_ok=True)

        print(f"Starting training for {epochs} epochs...")
        start_time = time.time()

        for epoch in range(epochs):
            epoch_start = time.time()

            metrics = self.train_epoch(steps_per_epoch)

            for k, v in metrics.items():
                history[k].append(v)

            epoch_time = time.time() - epoch_start

            # Print progress
            print(f"Epoch {epoch+1}/{epochs} - "
                  f"Loss: {metrics['loss']:.4f} "
                  f"(mag: {metrics['mag_loss']:.4f}, if: {metrics['if_loss']:.4f}) - "
                  f"Time: {epoch_time:.1f}s")

            # Save checkpoint
            if save_path and (epoch + 1) % save_every == 0:
                self.save_checkpoint(save_path / f"checkpoint_epoch_{epoch+1}.pt")

            # Save best model
            if metrics['loss'] < self.best_loss:
                self.best_loss = metrics['loss']
                if save_path:
                    self.save_checkpoint(save_path / "best_model.pt")

        total_time = time.time() - start_time
        print(f"Training complete in {total_time/60:.1f} minutes")

        return history

    def save_checkpoint(self, path: str):
        """Save model checkpoint."""
        torch.save({
            'epoch': self.epoch,
            'step': self.step,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'best_loss': self.best_loss
        }, path)
        print(f"Saved checkpoint to {path}")

    def load_checkpoint(self, path: str):
        """Load model checkpoint."""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.epoch = checkpoint['epoch']
        self.step = checkpoint['step']
        self.best_loss = checkpoint['best_loss']
        print(f"Loaded checkpoint from {path} (epoch {self.epoch})")


def train_naf(
    data_dir: Optional[str] = None,
    epochs: int = 200,
    device: str = 'cpu',
    save_dir: str = './naf_checkpoints',
    use_synthetic: bool = True
) -> NeuralAcousticField:
    """
    Convenience function to train NAF.

    Args:
        data_dir: Directory with training data (or None for synthetic)
        epochs: Number of epochs
        device: Training device ('cpu', 'cuda', 'mps')
        save_dir: Directory for checkpoints
        use_synthetic: Whether to use synthetic data for testing

    Returns:
        Trained model
    """
    # Create dataset
    if use_synthetic or data_dir is None:
        print("Using synthetic dataset for testing...")
        dataset = create_synthetic_dataset(num_samples=500)
    else:
        dataset = ImpulseResponseDataset(data_dir=data_dir)

    print(f"Dataset size: {len(dataset)} samples")

    # Create model
    model = create_naf_model(
        grid_size=32,
        hidden_dim=512,
        num_layers=8,
        device=device
    )

    # Count parameters
    num_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {num_params:,}")

    # Create trainer
    trainer = NAFTrainer(
        model=model,
        dataset=dataset,
        lr=5e-4,
        device=device,
        log_dir=save_dir + '/logs'
    )

    # Train
    history = trainer.train(
        epochs=epochs,
        steps_per_epoch=100,
        save_dir=save_dir
    )

    return model


if __name__ == "__main__":
    # Quick test
    import sys
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    print(f"Using device: {device}")

    model = train_naf(
        epochs=200,
        device=device,
        use_synthetic=True
    )

    print("Training complete!")
