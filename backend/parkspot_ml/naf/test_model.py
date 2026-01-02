"""
HNSF Model Inference Test & Visualization

Tests the trained hybrid model and creates visualizations of what it learned.
"""

import torch
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from naf.hybrid_model import HybridSpatialField, create_hybrid_model


def load_model(checkpoint_path: str, device: str = 'cpu'):
    """Load trained HNSF model from checkpoint."""
    model = create_hybrid_model(device=device)

    checkpoint = torch.load(checkpoint_path, map_location=device)
    if 'model_state_dict' in checkpoint:
        model.load_state_dict(checkpoint['model_state_dict'])
    else:
        model.load_state_dict(checkpoint)

    model.eval()
    print(f"Loaded model from {checkpoint_path}")
    epoch = checkpoint.get('epoch', 'unknown')
    loss = checkpoint.get('loss', None)
    loss_str = f"{loss:.6f}" if isinstance(loss, float) else str(loss)
    print(f"Epoch: {epoch}, Loss: {loss_str}")
    return model


def test_inference(model, device: str = 'cpu'):
    """Run basic inference tests."""
    print("\n" + "="*60)
    print("INFERENCE TESTS")
    print("="*60)

    with torch.no_grad():
        # Test 1: Single point query
        print("\n1. Single Point Query:")
        listener_pos = torch.tensor([[0.0, 0.0, 0.0]], device=device)
        emitter_pos = torch.tensor([[0.0, 0.0, 0.0]], device=device)
        orientation = torch.tensor([[0.0, 0.0]], device=device)
        channel = torch.tensor([0], device=device)
        rf_rssi = torch.tensor([[-65, -70, -80, -85, -90, -95, -100, -100, -100, -100, -100, -100, -100, -100, -100, -100]], device=device)

        result = model(
            listener_pos=listener_pos,
            emitter_pos=emitter_pos,
            orientation=orientation,
            channel=channel,
            rf_rssi=rf_rssi
        )

        print(f"   Loudness: {result['loudness'].item():.4f}")
        print(f"   Phase: {result['phase'].item():.4f}")
        print(f"   Structure: {result['structure'].squeeze().tolist()}")

        # Test 2: Different positions
        print("\n2. Position Variation Test:")
        positions = [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [2, 2, 0],
            [-2, -2, 0]
        ]

        for pos in positions:
            listener = torch.tensor([pos], dtype=torch.float32, device=device)
            result = model.predict_scene(listener, rf_rssi=rf_rssi)
            loudness = result['loudness'].item()
            struct = result['structure'][0, 0].item()  # First structure value
            print(f"   Pos {pos}: loudness={loudness:.4f}, struct[0]={struct:.4f}")

        # Test 3: RF influence
        print("\n3. RF Influence Test (same position, different RF):")
        listener = torch.tensor([[0.0, 0.0, 0.0]], device=device)

        rf_patterns = [
            ([-60]*5 + [-100]*11, "Strong (5 close beacons)"),
            ([-90]*5 + [-100]*11, "Weak (5 far beacons)"),
            ([-100]*16, "None (no beacons)"),
        ]

        for rf, desc in rf_patterns:
            rf_tensor = torch.tensor([rf], dtype=torch.float32, device=device)
            result = model.predict_scene(listener, rf_rssi=rf_tensor)
            loudness = result['loudness'].item()
            print(f"   {desc}: loudness={loudness:.4f}")

    print("\n" + "="*60)
    print("INFERENCE TESTS COMPLETE")
    print("="*60)


def visualize_learned_field(model, output_dir: str, device: str = 'cpu'):
    """Visualize what the model learned about spatial structure."""
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    print("\nGenerating visualizations...")

    with torch.no_grad():
        # Create grid of positions
        resolution = 32
        x = torch.linspace(-5, 5, resolution, device=device)
        y = torch.linspace(-5, 5, resolution, device=device)

        loudness_map = torch.zeros(resolution, resolution)
        structure_map = torch.zeros(resolution, resolution)

        # Fixed RF pattern (simulating some nearby beacons)
        rf_base = torch.tensor([[-70, -75, -80, -85, -90, -100, -100, -100, -100, -100, -100, -100, -100, -100, -100, -100]],
                               dtype=torch.float32, device=device)

        for i, xi in enumerate(x):
            for j, yj in enumerate(y):
                pos = torch.tensor([[xi.item(), yj.item(), 0.0]], device=device)
                orient = torch.tensor([[0.0, 0.0]], device=device)

                result = model.predict_scene(pos, orientation=orient, rf_rssi=rf_base)

                loudness_map[j, i] = result['loudness'].item()
                structure_map[j, i] = result['structure'][0, 0].item()

        # Plot 1: Loudness field
        fig, axes = plt.subplots(1, 3, figsize=(15, 5))
        fig.suptitle("What the HNSF Model Learned", fontsize=14, fontweight='bold')

        im1 = axes[0].imshow(loudness_map.cpu().numpy(), extent=[-5, 5, -5, 5],
                             origin='lower', cmap='magma')
        axes[0].set_title('Predicted Loudness Field')
        axes[0].set_xlabel('X (m)')
        axes[0].set_ylabel('Y (m)')
        plt.colorbar(im1, ax=axes[0], label='Loudness')

        im2 = axes[1].imshow(structure_map.cpu().numpy(), extent=[-5, 5, -5, 5],
                             origin='lower', cmap='viridis')
        axes[1].set_title('Predicted Structure (wall distance)')
        axes[1].set_xlabel('X (m)')
        axes[1].set_ylabel('Y (m)')
        plt.colorbar(im2, ax=axes[1], label='Structure')

        # Plot 3: RF influence comparison
        # No RF
        structure_no_rf = torch.zeros(resolution, resolution)
        rf_none = torch.tensor([[-100]*16], dtype=torch.float32, device=device)

        for i, xi in enumerate(x):
            for j, yj in enumerate(y):
                pos = torch.tensor([[xi.item(), yj.item(), 0.0]], device=device)
                result = model.predict_scene(pos, rf_rssi=rf_none)
                structure_no_rf[j, i] = result['structure'][0, 0].item()

        diff = structure_map - structure_no_rf
        im3 = axes[2].imshow(diff.cpu().numpy(), extent=[-5, 5, -5, 5],
                             origin='lower', cmap='RdBu', vmin=-0.5, vmax=0.5)
        axes[2].set_title('RF Contribution (with - without)')
        axes[2].set_xlabel('X (m)')
        axes[2].set_ylabel('Y (m)')
        plt.colorbar(im3, ax=axes[2], label='Δ Structure')

        plt.tight_layout()
        plt.savefig(output_path / 'model_learned_field.png', dpi=150, bbox_inches='tight')
        print(f"Saved: {output_path / 'model_learned_field.png'}")

        # Plot 2: Height influence (3D sensing)
        fig2, axes2 = plt.subplots(1, 2, figsize=(12, 5))
        fig2.suptitle("3D Sensing: Height Influence", fontsize=14, fontweight='bold')

        z_values = torch.linspace(-2, 2, resolution, device=device)
        height_profile = torch.zeros(resolution)

        for i, z in enumerate(z_values):
            pos = torch.tensor([[0.0, 0.0, z.item()]], device=device)
            result = model.predict_scene(pos, rf_rssi=rf_base)
            height_profile[i] = result['loudness'].item()

        axes2[0].plot(z_values.cpu().numpy(), height_profile.cpu().numpy(), 'b-', linewidth=2)
        axes2[0].set_xlabel('Height Z (m)')
        axes2[0].set_ylabel('Loudness')
        axes2[0].set_title('Loudness vs Height (X=0, Y=0)')
        axes2[0].axvline(0, color='gray', linestyle='--', alpha=0.5)
        axes2[0].grid(True, alpha=0.3)

        # XZ slice
        xz_loudness = torch.zeros(resolution, resolution)
        for i, xi in enumerate(x):
            for j, zj in enumerate(z_values):
                pos = torch.tensor([[xi.item(), 0.0, zj.item()]], device=device)
                result = model.predict_scene(pos, rf_rssi=rf_base)
                xz_loudness[j, i] = result['loudness'].item()

        im4 = axes2[1].imshow(xz_loudness.cpu().numpy(), extent=[-5, 5, -2, 2],
                              origin='lower', cmap='magma', aspect='auto')
        axes2[1].set_xlabel('X (m)')
        axes2[1].set_ylabel('Z (height, m)')
        axes2[1].set_title('Loudness Field (XZ slice, Y=0)')
        plt.colorbar(im4, ax=axes2[1], label='Loudness')

        plt.tight_layout()
        plt.savefig(output_path / 'model_3d_sensing.png', dpi=150, bbox_inches='tight')
        print(f"Saved: {output_path / 'model_3d_sensing.png'}")

    print("Visualizations complete!")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=str, default='naf_checkpoints/hybrid_best.pt')
    parser.add_argument('--output-dir', type=str, default='visualizations')
    parser.add_argument('--device', type=str, default='mps')
    args = parser.parse_args()

    # Detect device
    if args.device == 'mps' and not torch.backends.mps.is_available():
        args.device = 'cpu'
    print(f"Using device: {args.device}")

    # Load model
    model = load_model(args.checkpoint, args.device)

    # Run tests
    test_inference(model, args.device)

    # Create visualizations
    visualize_learned_field(model, args.output_dir, args.device)

    print("\n✅ All tests and visualizations complete!")


if __name__ == "__main__":
    main()
