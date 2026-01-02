"""
RF Encoder for Hybrid Neural Spatial Fields

Encodes BLE RSSI readings into latent features using attention
to handle variable numbers of visible beacons.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional


class RFEncoder(nn.Module):
    """
    Encode BLE RSSI readings into latent features.

    Uses attention mechanism to:
    1. Handle variable number of beacons
    2. Learn which beacons are most informative
    3. Aggregate into fixed-size latent

    Args:
        max_beacons: Maximum number of beacons to consider
        rssi_dim: Dimension of RSSI embedding
        hidden_dim: Output latent dimension
        num_heads: Number of attention heads
    """

    def __init__(
        self,
        max_beacons: int = 20,
        rssi_dim: int = 16,
        hidden_dim: int = 64,
        num_heads: int = 4
    ):
        super().__init__()

        self.max_beacons = max_beacons
        self.hidden_dim = hidden_dim

        # RSSI embedding: [-100 dBm, 0 dBm] → embed
        self.rssi_embed = nn.Sequential(
            nn.Linear(1, rssi_dim),
            nn.LayerNorm(rssi_dim),
            nn.LeakyReLU(0.1)
        )

        # Optional: beacon ID embedding (if beacon IDs are provided)
        self.beacon_embed = nn.Embedding(1000, rssi_dim)  # Up to 1000 unique beacons

        # Self-attention over beacons
        self.attention = nn.MultiheadAttention(
            embed_dim=rssi_dim,
            num_heads=num_heads,
            dropout=0.1,
            batch_first=True
        )

        # Output projection
        self.out_proj = nn.Sequential(
            nn.Linear(rssi_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.LeakyReLU(0.1)
        )

        # Learned query for aggregation
        self.query = nn.Parameter(torch.randn(1, 1, rssi_dim))

    def forward(
        self,
        rssi: torch.Tensor,
        beacon_ids: Optional[torch.Tensor] = None,
        mask: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Args:
            rssi: RSSI values [B, N] where N <= max_beacons
                  Values should be in dBm (typically -100 to 0)
            beacon_ids: Optional beacon identifiers [B, N]
            mask: Optional mask [B, N] where True = valid beacon

        Returns:
            Latent features [B, hidden_dim]
        """
        B, N = rssi.shape

        # Normalize RSSI to [-1, 1] range
        # RSSI typically ranges from -100 (weak) to -30 (strong)
        rssi_norm = (rssi + 65) / 35  # Center around -65 dBm
        rssi_norm = rssi_norm.clamp(-1, 1)

        # Embed RSSI values
        x = self.rssi_embed(rssi_norm.unsqueeze(-1))  # [B, N, rssi_dim]

        # Add beacon ID embedding if provided
        if beacon_ids is not None:
            beacon_emb = self.beacon_embed(beacon_ids.clamp(0, 999))
            x = x + beacon_emb

        # Create attention mask
        key_padding_mask = None
        if mask is not None:
            key_padding_mask = ~mask  # PyTorch expects True = ignore

        # Self-attention to mix beacon information
        x, _ = self.attention(x, x, x, key_padding_mask=key_padding_mask)

        # Aggregate using learned query (cross-attention style)
        query = self.query.expand(B, -1, -1)  # [B, 1, rssi_dim]
        attn_out, _ = self.attention(query, x, x, key_padding_mask=key_padding_mask)

        # Project to output dimension
        out = self.out_proj(attn_out.squeeze(1))  # [B, hidden_dim]

        return out


class SimpleRFEncoder(nn.Module):
    """
    Simpler RF encoder using MLP instead of attention.

    For when beacon order is fixed (e.g., known beacon IDs).
    """

    def __init__(self, num_beacons: int = 10, hidden_dim: int = 64):
        super().__init__()

        self.encoder = nn.Sequential(
            nn.Linear(num_beacons, 32),
            nn.LayerNorm(32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.LeakyReLU(0.1)
        )

    def forward(self, rssi: torch.Tensor) -> torch.Tensor:
        """
        Args:
            rssi: RSSI values [B, num_beacons]
        Returns:
            Latent features [B, hidden_dim]
        """
        # Normalize RSSI
        rssi_norm = (rssi + 65) / 35
        rssi_norm = rssi_norm.clamp(-1, 1)
        return self.encoder(rssi_norm)


def create_synthetic_rf_data(
    batch_size: int = 32,
    num_beacons: int = 10,
    device: str = 'cpu'
) -> tuple:
    """
    Create synthetic RF data for testing.

    Simulates RSSI based on distance to virtual beacons.

    Returns:
        rssi: [B, num_beacons]
        positions: [B, 3]
    """
    # Random listener positions
    positions = torch.rand(batch_size, 3, device=device) * 10 - 5  # [-5, 5]

    # Fixed beacon positions (spread around scene)
    beacon_pos = torch.zeros(num_beacons, 3, device=device)
    for i in range(num_beacons):
        angle = 2 * 3.14159 * i / num_beacons
        beacon_pos[i, 0] = 4 * torch.cos(torch.tensor(angle))
        beacon_pos[i, 1] = 4 * torch.sin(torch.tensor(angle))
        beacon_pos[i, 2] = 0

    # Calculate distances
    distances = torch.cdist(positions, beacon_pos)  # [B, num_beacons]

    # Convert to RSSI (inverse square law + noise)
    # RSSI ≈ -40 - 10 * n * log10(d)  where n ≈ 2-4
    rssi = -40 - 20 * torch.log10(distances.clamp(min=0.1))
    rssi = rssi + torch.randn_like(rssi) * 3  # Add noise
    rssi = rssi.clamp(-100, -30)

    return rssi, positions
