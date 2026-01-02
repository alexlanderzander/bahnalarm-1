"""
NAF Visualization Module

Generates loudness maps and scene structure visualizations
from trained NAF models.
"""

import torch
import numpy as np
from typing import Tuple, Optional
import matplotlib.pyplot as plt
import io
import base64

from .model import NeuralAcousticField


class NAFVisualizer:
    """
    Generates visualizations from trained NAF models.

    Creates:
        - Loudness field maps (like Figure 1 in paper)
        - Scene structure predictions (wall distances)
        - Acoustic propagation animations
    """

    def __init__(
        self,
        model: NeuralAcousticField,
        device: str = 'cpu',
        grid_resolution: int = 64
    ):
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.grid_resolution = grid_resolution

    @torch.no_grad()
    def generate_loudness_field(
        self,
        emitter_pos: Tuple[float, float],
        scene_bounds: Tuple[Tuple[float, float], Tuple[float, float]] = ((-5, 5), (-5, 5)),
        resolution: Optional[int] = None
    ) -> np.ndarray:
        """
        Generate 2D loudness field for given emitter position.

        Args:
            emitter_pos: (x, y) position of sound emitter
            scene_bounds: ((x_min, x_max), (y_min, y_max))
            resolution: Grid resolution (default: self.grid_resolution)

        Returns:
            loudness: [resolution, resolution] array of loudness values
        """
        res = resolution or self.grid_resolution

        # Create listener position grid
        x = torch.linspace(scene_bounds[0][0], scene_bounds[0][1], res)
        y = torch.linspace(scene_bounds[1][0], scene_bounds[1][1], res)
        grid_x, grid_y = torch.meshgrid(x, y, indexing='ij')

        # Flatten for batch processing
        listener_pos = torch.stack([grid_x.flatten(), grid_y.flatten()], dim=-1).to(self.device)

        # Emitter position (same for all)
        emitter = torch.tensor([emitter_pos], dtype=torch.float32).expand(res * res, -1).to(self.device)

        # Sample time-frequency grid and average
        t_samples = 16
        f_samples = 16

        total_energy = torch.zeros(res * res, device=self.device)

        for ti in torch.linspace(-1, 1, t_samples):
            for fi in torch.linspace(-1, 1, f_samples):
                time = torch.full((res * res,), ti.item(), device=self.device)
                freq = torch.full((res * res,), fi.item(), device=self.device)

                mag, _ = self.model(listener_pos, emitter, time, freq)
                total_energy += torch.exp(mag.squeeze())

        # Average and reshape
        loudness = total_energy / (t_samples * f_samples)
        loudness = loudness.reshape(res, res).cpu().numpy()

        return loudness

    @torch.no_grad()
    def extract_scene_structure(
        self,
        scene_bounds: Tuple[Tuple[float, float], Tuple[float, float]] = ((-5, 5), (-5, 5)),
        num_listener_samples: int = 5,
        resolution: Optional[int] = None
    ) -> np.ndarray:
        """
        Extract scene structure from NAF latent features.

        Following paper Section 4.5:
        For each position, extract NAF latents and decode structure.

        Args:
            scene_bounds: Scene bounding box
            num_listener_samples: Number of listener positions to average
            resolution: Output resolution

        Returns:
            structure: [resolution, resolution] predicted structure
        """
        res = resolution or self.grid_resolution

        # Create emitter position grid
        x = torch.linspace(scene_bounds[0][0], scene_bounds[0][1], res)
        y = torch.linspace(scene_bounds[1][0], scene_bounds[1][1], res)
        grid_x, grid_y = torch.meshgrid(x, y, indexing='ij')
        emitter_pos = torch.stack([grid_x.flatten(), grid_y.flatten()], dim=-1).to(self.device)

        # Sample random listener positions
        listener_samples = torch.rand(num_listener_samples, 2, device=self.device)
        listener_samples = listener_samples * torch.tensor(
            [scene_bounds[0][1] - scene_bounds[0][0], scene_bounds[1][1] - scene_bounds[1][0]],
            device=self.device
        ) + torch.tensor([scene_bounds[0][0], scene_bounds[1][0]], device=self.device)

        # Collect latent features
        all_latents = []

        for listener in listener_samples:
            listener_expanded = listener.unsqueeze(0).expand(res * res, -1)

            # Get features from feature grid
            emitter_feat = self.model.feature_grid(emitter_pos)
            listener_feat = self.model.feature_grid(listener_expanded)

            # Combine
            combined = emitter_feat + listener_feat
            all_latents.append(combined)

        # Average across listener positions
        latents = torch.stack(all_latents).mean(dim=0)

        # Use latent norm as proxy for structure (higher = closer to boundaries)
        structure = torch.norm(latents, dim=-1)
        structure = structure.reshape(res, res).cpu().numpy()

        return structure

    def plot_loudness_field(
        self,
        emitter_pos: Tuple[float, float],
        scene_bounds: Tuple[Tuple[float, float], Tuple[float, float]] = ((-5, 5), (-5, 5)),
        title: str = "Acoustic Loudness Field",
        show: bool = True,
        save_path: Optional[str] = None
    ) -> Optional[str]:
        """
        Generate and plot loudness field visualization.

        Returns base64 encoded PNG if save_path is None.
        """
        loudness = self.generate_loudness_field(emitter_pos, scene_bounds)

        fig, ax = plt.subplots(figsize=(8, 8))

        # Plot heatmap
        im = ax.imshow(
            loudness.T,
            origin='lower',
            extent=[scene_bounds[0][0], scene_bounds[0][1],
                    scene_bounds[1][0], scene_bounds[1][1]],
            cmap='hot',
            aspect='equal'
        )

        # Mark emitter position
        ax.plot(emitter_pos[0], emitter_pos[1], 'ro', markersize=10, label='Emitter')

        ax.set_xlabel('X (meters)')
        ax.set_ylabel('Y (meters)')
        ax.set_title(title)
        ax.legend()

        plt.colorbar(im, ax=ax, label='Loudness')

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            plt.close()
            return save_path
        elif show:
            plt.show()
            return None
        else:
            # Return base64 encoded
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
            plt.close()
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('utf-8')

    def plot_scene_structure(
        self,
        scene_bounds: Tuple[Tuple[float, float], Tuple[float, float]] = ((-5, 5), (-5, 5)),
        title: str = "Inferred Scene Structure",
        show: bool = True,
        save_path: Optional[str] = None
    ) -> Optional[str]:
        """
        Generate and plot scene structure visualization.
        """
        structure = self.extract_scene_structure(scene_bounds)

        fig, ax = plt.subplots(figsize=(8, 8))

        im = ax.imshow(
            structure.T,
            origin='lower',
            extent=[scene_bounds[0][0], scene_bounds[0][1],
                    scene_bounds[1][0], scene_bounds[1][1]],
            cmap='viridis',
            aspect='equal'
        )

        ax.set_xlabel('X (meters)')
        ax.set_ylabel('Y (meters)')
        ax.set_title(title)

        plt.colorbar(im, ax=ax, label='Structure Score')

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            plt.close()
            return save_path
        elif show:
            plt.show()
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
            plt.close()
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('utf-8')


def generate_loudness_map_json(
    model: NeuralAcousticField,
    emitter_pos: Tuple[float, float],
    scene_bounds: Tuple[Tuple[float, float], Tuple[float, float]],
    resolution: int = 32,
    device: str = 'cpu'
) -> dict:
    """
    Generate loudness map as JSON-serializable dict for API.

    Returns:
        {
            'emitter': [x, y],
            'bounds': [[x_min, x_max], [y_min, y_max]],
            'resolution': int,
            'data': [[float, ...], ...]  # 2D loudness values
        }
    """
    visualizer = NAFVisualizer(model, device=device, grid_resolution=resolution)
    loudness = visualizer.generate_loudness_field(emitter_pos, scene_bounds, resolution)

    return {
        'emitter': list(emitter_pos),
        'bounds': [list(b) for b in scene_bounds],
        'resolution': resolution,
        'data': loudness.tolist()
    }
