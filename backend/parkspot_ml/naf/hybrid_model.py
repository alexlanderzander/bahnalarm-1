"""
Hybrid Neural Spatial Fields (HNSF)

Multi-modal spatial sensing model combining:
- NAF (Acoustic): Sound propagation, room geometry
- NRF (RF): BLE RSSI patterns, device positions

With full paper parameters: 3D position, orientation, channel.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Tuple, Optional, Dict

from .model import SinusoidalEncoding, LocalFeatureGrid
from .rf_encoder import RFEncoder, SimpleRFEncoder


class LocalFeatureGrid3D(nn.Module):
    """
    Learnable 3D grid of spatial latent features.

    Extension of 2D grid to support full 3D positions.
    Uses trilinear interpolation with Gaussian weighting.
    """

    def __init__(
        self,
        grid_size: int = 16,  # Smaller for 3D
        feature_dim: int = 64,
        sigma: float = 0.3,
        bounds: Tuple[Tuple[float, float], ...] = ((-5.0, 5.0), (-5.0, 5.0), (-2.0, 2.0))
    ):
        super().__init__()

        self.grid_size = grid_size
        self.feature_dim = feature_dim

        # 3D grid of features
        self.grid = nn.Parameter(
            torch.randn(grid_size, grid_size, grid_size, feature_dim, dtype=torch.float32)
            / float(np.sqrt(feature_dim))
        )

        # Learnable bandwidth
        self.log_sigma = nn.Parameter(torch.tensor(float(np.log(sigma)), dtype=torch.float32))

        # Bounds
        self.register_buffer('bounds', torch.tensor(bounds, dtype=torch.float32))

        # Precompute grid coordinates
        x = torch.linspace(bounds[0][0], bounds[0][1], grid_size, dtype=torch.float32)
        y = torch.linspace(bounds[1][0], bounds[1][1], grid_size, dtype=torch.float32)
        z = torch.linspace(bounds[2][0], bounds[2][1], grid_size, dtype=torch.float32)
        grid_x, grid_y, grid_z = torch.meshgrid(x, y, z, indexing='ij')
        self.register_buffer('grid_coords', torch.stack([grid_x, grid_y, grid_z], dim=-1))

    @property
    def sigma(self) -> torch.Tensor:
        return torch.exp(self.log_sigma)

    def forward(self, pos: torch.Tensor) -> torch.Tensor:
        """
        Query features at 3D positions.

        Args:
            pos: Positions [B, 3] (x, y, z)
        Returns:
            Features [B, feature_dim]
        """
        B = pos.shape[0]
        G = self.grid_size

        # Expand for broadcasting: [B, 1, 1, 1, 3] vs [G, G, G, 3]
        pos_expanded = pos.view(B, 1, 1, 1, 3)

        # Squared distances: [B, G, G, G]
        sq_dist = ((pos_expanded - self.grid_coords) ** 2).sum(dim=-1)

        # Gaussian weights
        weights = torch.exp(-sq_dist / (2 * self.sigma ** 2))

        # Normalize
        weights = weights / (weights.sum(dim=(-3, -2, -1), keepdim=True) + 1e-8)

        # Weighted sum: [B, G, G, G] @ [G, G, G, F] -> [B, F]
        features = torch.einsum('bxyz,xyzf->bf', weights, self.grid)

        return features


class AcousticEncoder(nn.Module):
    """
    Encode acoustic STFT features with time-frequency coordinate.

    Input: STFT magnitude at specific (t, f) coordinate
    Output: Latent features for fusion
    """

    def __init__(self, hidden_dim: int = 64, tf_freqs: int = 10):
        super().__init__()

        self.tf_encoder = SinusoidalEncoding(num_freqs=tf_freqs, max_freq=1024.0)
        tf_enc_dim = self.tf_encoder.output_dim(2)  # time + freq

        self.mlp = nn.Sequential(
            nn.Linear(tf_enc_dim + 1, hidden_dim),  # +1 for magnitude
            nn.LayerNorm(hidden_dim),
            nn.LeakyReLU(0.1),
            nn.Linear(hidden_dim, hidden_dim)
        )

    def forward(
        self,
        magnitude: torch.Tensor,  # [B,]
        time: torch.Tensor,       # [B,]
        freq: torch.Tensor        # [B,]
    ) -> torch.Tensor:
        """Encode acoustic sample at (t, f) coordinate."""
        tf = torch.stack([time, freq], dim=-1)
        tf_enc = self.tf_encoder(tf)

        x = torch.cat([tf_enc, magnitude.unsqueeze(-1)], dim=-1)
        return self.mlp(x)


class HybridSpatialField(nn.Module):
    """
    Hybrid Neural Spatial Field combining acoustic + RF modalities.

    Full paper specification:
    - 3D positions (x, y, z)
    - Orientation (θ azimuth, φ elevation)
    - Channel indicator (L/R for binaural)
    - Acoustic STFT features
    - RF RSSI features
    - Shared spatial grid

    Args:
        grid_size: Size of 3D spatial grid
        hidden_dim: Hidden dimension of fusion MLP
        num_layers: Number of MLP layers
        pos_freqs: Frequencies for position encoding
        orient_freqs: Frequencies for orientation encoding
        acoustic_dim: Acoustic encoder output dim
        rf_dim: RF encoder output dim
    """

    def __init__(
        self,
        grid_size: int = 16,
        grid_feature_dim: int = 64,
        hidden_dim: int = 512,
        num_layers: int = 8,
        pos_freqs: int = 10,
        orient_freqs: int = 6,
        acoustic_dim: int = 64,
        rf_dim: int = 64,
        num_beacons: int = 16  # Changed from 10 to 16 for real data
    ):
        super().__init__()

        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        # Shared 3D spatial grid
        self.feature_grid = LocalFeatureGrid3D(
            grid_size=grid_size,
            feature_dim=grid_feature_dim
        )

        # Position encoder (3D)
        self.pos_encoder = SinusoidalEncoding(num_freqs=pos_freqs, max_freq=128.0)

        # Orientation encoder (θ, φ)
        self.orient_encoder = SinusoidalEncoding(num_freqs=orient_freqs, max_freq=32.0)

        # Channel embedding (L/R)
        self.channel_embed = nn.Embedding(2, 8)

        # Modality encoders
        self.acoustic_encoder = AcousticEncoder(hidden_dim=acoustic_dim)
        self.rf_encoder = SimpleRFEncoder(num_beacons=num_beacons, hidden_dim=rf_dim)

        # Calculate input dimension
        pos_enc_dim = self.pos_encoder.output_dim(3)    # 3D position
        orient_enc_dim = self.orient_encoder.output_dim(2)  # θ, φ
        channel_dim = 8
        grid_dim = grid_feature_dim * 2  # listener + emitter

        # Base input (always present)
        base_dim = 2 * pos_enc_dim + orient_enc_dim + channel_dim + grid_dim

        # Full input with both modalities
        full_input_dim = base_dim + acoustic_dim + rf_dim

        # Fusion MLP layers
        self.layers = nn.ModuleList()
        self.layers.append(nn.Linear(full_input_dim, hidden_dim))

        for i in range(1, num_layers):
            in_dim = hidden_dim
            if i == 4:  # Skip connection at layer 4
                in_dim = hidden_dim + full_input_dim
            self.layers.append(nn.Linear(in_dim, hidden_dim))

        # Output heads
        self.loudness_head = nn.Linear(hidden_dim, 1)
        self.phase_head = nn.Linear(hidden_dim, 1)
        self.structure_head = nn.Linear(hidden_dim, 4)  # 4 wall distances

        self.activation = nn.LeakyReLU(0.1)

        # Store dimensions for reference
        self.base_dim = base_dim
        self.full_input_dim = full_input_dim
        self.acoustic_dim = acoustic_dim
        self.rf_dim = rf_dim

    def forward(
        self,
        listener_pos: torch.Tensor,   # [B, 3]
        emitter_pos: torch.Tensor,    # [B, 3]
        orientation: torch.Tensor,    # [B, 2] (θ, φ)
        channel: torch.Tensor,        # [B,] int
        time: Optional[torch.Tensor] = None,       # [B,]
        freq: Optional[torch.Tensor] = None,       # [B,]
        acoustic_mag: Optional[torch.Tensor] = None,  # [B,]
        rf_rssi: Optional[torch.Tensor] = None     # [B, num_beacons]
    ) -> Dict[str, torch.Tensor]:
        """
        Forward pass with optional multi-modal inputs.

        Args:
            listener_pos: Listener 3D position
            emitter_pos: Emitter 3D position
            orientation: (azimuth θ, elevation φ) in radians
            channel: Left (0) or right (1) channel
            time: Normalized time coordinate [-1, 1]
            freq: Normalized frequency coordinate [-1, 1]
            acoustic_mag: STFT magnitude (log-scale)
            rf_rssi: BLE RSSI vector

        Returns:
            Dictionary with 'loudness', 'phase', 'structure'
        """
        B = listener_pos.shape[0]
        device = listener_pos.device

        # Encode positions
        listener_enc = self.pos_encoder(listener_pos)
        emitter_enc = self.pos_encoder(emitter_pos)

        # Encode orientation
        orient_enc = self.orient_encoder(orientation)

        # Encode channel
        channel_enc = self.channel_embed(channel.long())

        # Get spatial features from shared grid
        listener_feat = self.feature_grid(listener_pos)
        emitter_feat = self.feature_grid(emitter_pos)

        # Base features (always available)
        base_feats = torch.cat([
            listener_enc,
            emitter_enc,
            orient_enc,
            channel_enc,
            listener_feat,
            emitter_feat
        ], dim=-1)

        # Modality features (with defaults for missing)
        if acoustic_mag is not None and time is not None and freq is not None:
            acoustic_feat = self.acoustic_encoder(acoustic_mag, time, freq)
        else:
            acoustic_feat = torch.zeros(B, self.acoustic_dim, device=device)

        if rf_rssi is not None:
            rf_feat = self.rf_encoder(rf_rssi)
        else:
            rf_feat = torch.zeros(B, self.rf_dim, device=device)

        # Combine all features
        x = torch.cat([base_feats, acoustic_feat, rf_feat], dim=-1)
        skip_input = x

        # Forward through fusion MLP
        h = x
        for i, layer in enumerate(self.layers):
            if i == 4:
                h = torch.cat([h, skip_input], dim=-1)
            h = self.activation(layer(h))

        # Output heads
        loudness = self.loudness_head(h)
        phase = self.phase_head(h)
        structure = self.structure_head(h)

        return {
            'loudness': loudness,
            'phase': phase,
            'structure': structure,
            'latent': h
        }

    def predict_scene(
        self,
        listener_pos: torch.Tensor,
        orientation: Optional[torch.Tensor] = None,
        rf_rssi: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Predict scene structure at listener position.

        Uses RF if available, otherwise spatial grid only.
        """
        B = listener_pos.shape[0]
        device = listener_pos.device

        if orientation is None:
            orientation = torch.zeros(B, 2, device=device)

        channel = torch.zeros(B, dtype=torch.long, device=device)

        # Use listener as emitter for scene query
        return self.forward(
            listener_pos=listener_pos,
            emitter_pos=listener_pos,
            orientation=orientation,
            channel=channel,
            rf_rssi=rf_rssi
        )


def create_hybrid_model(
    grid_size: int = 16,
    hidden_dim: int = 512,
    num_layers: int = 8,
    device: str = 'cpu'
) -> HybridSpatialField:
    """Factory function for HybridSpatialField."""
    model = HybridSpatialField(
        grid_size=grid_size,
        hidden_dim=hidden_dim,
        num_layers=num_layers
    )
    return model.to(device)
