"""
Neural Acoustic Fields (NAF) - PyTorch Implementation

Based on: "Learning Neural Acoustic Fields" (NeurIPS 2022)
Authors: Luo et al. (MIT, CMU)

This module implements NAF for spatial environment visualization
by learning to predict impulse responses from emitter-listener pairs.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Tuple, Optional


class SinusoidalEncoding(nn.Module):
    """
    Sinusoidal positional encoding (Fourier features).

    Maps input coordinates to higher-dimensional space using
    sin/cos at multiple frequencies for better learning of
    high-frequency variations.

    Args:
        num_freqs: Number of frequency bands
        max_freq: Maximum frequency (2^max_freq_exp)
        include_input: Whether to include original input in output
    """

    def __init__(self, num_freqs: int = 10, max_freq: float = 128.0, include_input: bool = True):
        super().__init__()
        self.num_freqs = num_freqs
        self.include_input = include_input

        # Frequencies: 2^0 to 2^(log2(max_freq)) linearly spaced
        freqs = 2.0 ** torch.linspace(0, float(np.log2(max_freq)), num_freqs, dtype=torch.float32)
        self.register_buffer('freqs', freqs)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: Input tensor of shape [..., D]
        Returns:
            Encoded tensor of shape [..., D * (2 * num_freqs + include_input)]
        """
        # x: [..., D] -> [..., D, 1] * [num_freqs] -> [..., D, num_freqs]
        x_freq = x.unsqueeze(-1) * self.freqs * np.pi

        # Concatenate sin and cos
        encoded = torch.cat([torch.sin(x_freq), torch.cos(x_freq)], dim=-1)

        # Flatten last two dims: [..., D, 2*num_freqs] -> [..., D*2*num_freqs]
        encoded = encoded.flatten(-2)

        if self.include_input:
            encoded = torch.cat([x, encoded], dim=-1)

        return encoded

    def output_dim(self, input_dim: int) -> int:
        """Calculate output dimension given input dimension."""
        base = input_dim * 2 * self.num_freqs
        return base + input_dim if self.include_input else base


class LocalFeatureGrid(nn.Module):
    """
    Learnable 2D grid of spatial latent features.

    Provides local geometric conditioning by learning features
    at grid points that are interpolated using Gaussian-weighted
    Nadaraya-Watson estimation.

    Args:
        grid_size: Number of grid points per dimension
        feature_dim: Dimension of feature at each grid point
        sigma: Initial bandwidth for Gaussian kernel
        bounds: Scene bounds [[x_min, x_max], [y_min, y_max]]
    """

    def __init__(
        self,
        grid_size: int = 32,
        feature_dim: int = 64,
        sigma: float = 0.25,
        bounds: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None
    ):
        super().__init__()

        self.grid_size = grid_size
        self.feature_dim = feature_dim

        # Initialize grid features (paper: N(0, 1/sqrt(feature_dim)))
        self.grid = nn.Parameter(
            torch.randn(grid_size, grid_size, feature_dim, dtype=torch.float32) / float(np.sqrt(feature_dim))
        )

        # Learnable bandwidth (paper: jointly trained)
        self.log_sigma = nn.Parameter(torch.tensor(float(np.log(sigma)), dtype=torch.float32))

        # Scene bounds (default: normalized [-1, 1])
        if bounds is None:
            bounds = ((-1.0, 1.0), (-1.0, 1.0))
        self.register_buffer('x_bounds', torch.tensor(bounds[0], dtype=torch.float32))
        self.register_buffer('y_bounds', torch.tensor(bounds[1], dtype=torch.float32))

        # Precompute grid coordinates
        x = torch.linspace(bounds[0][0], bounds[0][1], grid_size, dtype=torch.float32)
        y = torch.linspace(bounds[1][0], bounds[1][1], grid_size, dtype=torch.float32)
        grid_x, grid_y = torch.meshgrid(x, y, indexing='ij')
        self.register_buffer('grid_coords', torch.stack([grid_x, grid_y], dim=-1))

    @property
    def sigma(self) -> torch.Tensor:
        return torch.exp(self.log_sigma)

    def forward(self, pos: torch.Tensor) -> torch.Tensor:
        """
        Query features at given positions using Gaussian-weighted interpolation.

        Args:
            pos: Positions of shape [B, 2] (x, y coordinates)
        Returns:
            Features of shape [B, feature_dim]
        """
        B = pos.shape[0]

        # Compute distances from query to all grid points
        # pos: [B, 2] -> [B, 1, 1, 2]
        # grid_coords: [G, G, 2]
        pos_expanded = pos.view(B, 1, 1, 2)

        # Squared distances: [B, G, G]
        sq_dist = ((pos_expanded - self.grid_coords) ** 2).sum(dim=-1)

        # Gaussian weights: [B, G, G]
        weights = torch.exp(-sq_dist / (2 * self.sigma ** 2))

        # Normalize weights (Nadaraya-Watson)
        weights = weights / (weights.sum(dim=(-2, -1), keepdim=True) + 1e-8)

        # Weighted sum of features: [B, G, G] @ [G, G, F] -> [B, F]
        features = torch.einsum('bxy,xyf->bf', weights, self.grid)

        return features


class NeuralAcousticField(nn.Module):
    """
    Neural Acoustic Field (NAF) - Main model.

    Maps emitter-listener position pairs to impulse response spectrograms
    in the time-frequency domain (STFT magnitude and instantaneous frequency).

    Architecture:
        - Shared local feature grid for geometric conditioning
        - Sinusoidal encoding for positions and time-frequency coords
        - 8-layer MLP with skip connection at layer 4
        - Outputs: log-magnitude and instantaneous frequency

    Args:
        grid_size: Size of local feature grid
        hidden_dim: Hidden dimension of MLP
        num_layers: Number of MLP layers
        pos_freqs: Number of frequencies for position encoding
        tf_freqs: Number of frequencies for time-frequency encoding
    """

    def __init__(
        self,
        grid_size: int = 32,
        hidden_dim: int = 512,
        num_layers: int = 8,
        pos_freqs: int = 10,
        tf_freqs: int = 10,
        feature_dim: int = 64
    ):
        super().__init__()

        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        # Encoders
        self.pos_encoder = SinusoidalEncoding(num_freqs=pos_freqs, max_freq=128.0)
        self.tf_encoder = SinusoidalEncoding(num_freqs=tf_freqs, max_freq=1024.0)

        # Shared local feature grid (acoustic reciprocity)
        self.feature_grid = LocalFeatureGrid(grid_size=grid_size, feature_dim=feature_dim)

        # Calculate input dimension
        # 2 positions (listener + emitter) * 2 coords each = 4 values encoded
        # 2 grid features (listener + emitter)
        # time + frequency encoded
        pos_enc_dim = self.pos_encoder.output_dim(2)  # 2D position
        tf_enc_dim = self.tf_encoder.output_dim(2)    # time + frequency

        input_dim = 2 * pos_enc_dim + 2 * feature_dim + tf_enc_dim

        # Main MLP layers
        self.layers = nn.ModuleList()
        self.layers.append(nn.Linear(input_dim, hidden_dim))

        for i in range(1, num_layers):
            in_dim = hidden_dim
            # Skip connection at layer 4 (add input features)
            if i == 4:
                in_dim = hidden_dim + input_dim
            self.layers.append(nn.Linear(in_dim, hidden_dim))

        # Skip connection projection
        self.skip_proj = nn.Linear(input_dim, hidden_dim)

        # Output heads
        self.head_magnitude = nn.Linear(hidden_dim, 1)
        self.head_phase = nn.Linear(hidden_dim, 1)

        # Activation
        self.activation = nn.LeakyReLU(0.1)

        # Store input dim for reference
        self.input_dim = input_dim

    def forward(
        self,
        listener_pos: torch.Tensor,
        emitter_pos: torch.Tensor,
        time: torch.Tensor,
        freq: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass.

        Args:
            listener_pos: Listener positions [B, 2]
            emitter_pos: Emitter positions [B, 2]
            time: Time coordinates [B] (normalized to [-1, 1])
            freq: Frequency coordinates [B] (normalized to [-1, 1])

        Returns:
            magnitude: Log-magnitude STFT values [B, 1]
            phase: Instantaneous frequency values [B, 1]
        """
        # Get local geometric features (shared grid)
        listener_feat = self.feature_grid(listener_pos)
        emitter_feat = self.feature_grid(emitter_pos)

        # Encode positions
        listener_enc = self.pos_encoder(listener_pos)
        emitter_enc = self.pos_encoder(emitter_pos)

        # Encode time-frequency
        tf = torch.stack([time, freq], dim=-1)
        tf_enc = self.tf_encoder(tf)

        # Combine all inputs
        x = torch.cat([
            listener_enc,
            emitter_enc,
            listener_feat,
            emitter_feat,
            tf_enc
        ], dim=-1)

        # Store for skip connection
        skip_input = x

        # Forward through MLP
        h = x
        for i, layer in enumerate(self.layers):
            if i == 4:
                # Skip connection at layer 4
                h = torch.cat([h, skip_input], dim=-1)
            h = self.activation(layer(h))

        # Output heads
        magnitude = self.head_magnitude(h)
        phase = self.head_phase(h)

        return magnitude, phase

    def predict_loudness(
        self,
        listener_pos: torch.Tensor,
        emitter_pos: torch.Tensor,
        aggregate: str = 'mean'
    ) -> torch.Tensor:
        """
        Predict loudness (energy) at listener position given emitter.

        Integrates over time-frequency to get total energy.

        Args:
            listener_pos: [B, 2]
            emitter_pos: [B, 2]
            aggregate: How to aggregate ('mean', 'sum', 'max')

        Returns:
            loudness: [B, 1]
        """
        B = listener_pos.shape[0]
        device = listener_pos.device

        # Sample grid of time-frequency points
        n_samples = 64
        t = torch.linspace(-1, 1, n_samples, device=device)
        f = torch.linspace(-1, 1, n_samples, device=device)

        # Batch all combinations
        total_mag = 0
        for ti in t:
            for fi in f:
                time = torch.full((B,), ti, device=device)
                freq = torch.full((B,), fi, device=device)
                mag, _ = self.forward(listener_pos, emitter_pos, time, freq)
                total_mag = total_mag + torch.exp(mag)

        if aggregate == 'mean':
            loudness = total_mag / (n_samples * n_samples)
        elif aggregate == 'sum':
            loudness = total_mag
        else:  # max would need different implementation
            loudness = total_mag / (n_samples * n_samples)

        return loudness


class SceneStructureDecoder(nn.Module):
    """
    Decode scene structure from NAF latent features.

    Following the paper, NAF latents can predict scene structure
    (e.g., distance to nearest wall) with high explained variance.

    Args:
        latent_dim: Dimension of NAF latents (hidden_dim)
        output_dim: Dimension of output (1 for wall distance)
    """

    def __init__(self, latent_dim: int = 512, output_dim: int = 1):
        super().__init__()
        self.decoder = nn.Linear(latent_dim, output_dim)

    def forward(self, latents: torch.Tensor) -> torch.Tensor:
        """
        Args:
            latents: NAF hidden features [B, latent_dim]
        Returns:
            structure: Predicted structure (e.g., wall distance) [B, output_dim]
        """
        return self.decoder(latents)


def create_naf_model(
    grid_size: int = 32,
    hidden_dim: int = 512,
    num_layers: int = 8,
    device: str = 'cpu'
) -> NeuralAcousticField:
    """Factory function to create NAF model with default settings."""
    model = NeuralAcousticField(
        grid_size=grid_size,
        hidden_dim=hidden_dim,
        num_layers=num_layers
    )
    return model.to(device)
