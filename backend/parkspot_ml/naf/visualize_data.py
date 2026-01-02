"""
Visualize NAF Training Data - What the AI Sees

Creates visualizations of:
1. Acoustic STFT spectrograms
2. RF RSSI heatmaps
3. Position + orientation trajectory
4. Sample statistics
"""

import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from mpl_toolkits.mplot3d import Axes3D
import argparse


def load_all_samples(data_dir: str):
    """Load all NPZ samples from training data directory."""
    samples = []
    data_path = Path(data_dir)

    for device_dir in data_path.iterdir():
        if device_dir.is_dir():
            for session_dir in device_dir.iterdir():
                if session_dir.is_dir():
                    for npz_file in session_dir.glob("*.npz"):
                        try:
                            data = np.load(npz_file)
                            samples.append({
                                'file': str(npz_file),
                                'listener_pos': data['listener_pos'],
                                'orientation': data['orientation'],
                                'stft_mag': data['stft_mag'],
                                'stft_if': data['stft_if'],
                                'rf_rssi': data.get('rf_rssi', np.full(16, -100)),
                                'rf_beacon_count': data.get('rf_beacon_count', 0),
                                'timestamp': data.get('timestamp', 0)
                            })
                        except Exception as e:
                            print(f"Error loading {npz_file}: {e}")

    return samples


def visualize_single_sample(sample, save_path=None):
    """Visualize a single sample showing what the AI sees."""
    fig = plt.figure(figsize=(16, 10))
    fig.suptitle("What the AI Sees - Single Sample", fontsize=14, fontweight='bold')

    # 1. STFT Magnitude Spectrogram
    ax1 = fig.add_subplot(2, 3, 1)
    stft = sample['stft_mag']
    im1 = ax1.imshow(stft.T, aspect='auto', origin='lower', cmap='magma')
    ax1.set_xlabel('Time Frame')
    ax1.set_ylabel('Frequency Bin')
    ax1.set_title('Acoustic STFT (Magnitude)')
    plt.colorbar(im1, ax=ax1, label='Log Magnitude')

    # 2. STFT Instantaneous Frequency (Phase)
    ax2 = fig.add_subplot(2, 3, 2)
    stft_if = sample['stft_if']
    im2 = ax2.imshow(stft_if.T, aspect='auto', origin='lower', cmap='twilight')
    ax2.set_xlabel('Time Frame')
    ax2.set_ylabel('Frequency Bin')
    ax2.set_title('Acoustic STFT (Phase/IF)')
    plt.colorbar(im2, ax=ax2, label='Inst. Frequency')

    # 3. RF RSSI Pattern
    ax3 = fig.add_subplot(2, 3, 3)
    rssi = sample['rf_rssi']
    colors = plt.cm.RdYlGn(np.clip((rssi + 100) / 60, 0, 1))  # -100 to -40 range
    bars = ax3.bar(range(len(rssi)), rssi + 100, color=colors)
    ax3.axhline(y=40, color='red', linestyle='--', alpha=0.5, label='Weak signal')
    ax3.set_xlabel('Beacon Index (sorted by strength)')
    ax3.set_ylabel('RSSI + 100 (dB)')
    ax3.set_title(f'RF Fingerprint ({sample["rf_beacon_count"]} beacons)')
    ax3.set_xlim(-0.5, 15.5)
    ax3.set_ylim(0, 70)

    # 4. Position Info
    ax4 = fig.add_subplot(2, 3, 4)
    pos = sample['listener_pos']
    orient = sample['orientation']

    ax4.arrow(0, 0, np.cos(orient[0]) * 0.5, np.sin(orient[0]) * 0.5,
              head_width=0.1, head_length=0.05, fc='blue', ec='blue')
    ax4.plot(0, 0, 'ro', markersize=10, label='Phone position')
    ax4.set_xlim(-1, 1)
    ax4.set_ylim(-1, 1)
    ax4.set_aspect('equal')
    ax4.set_title(f'Orientation: yaw={orient[0]:.2f}rad, pitch={orient[1]:.2f}rad')
    ax4.set_xlabel('X')
    ax4.set_ylabel('Y')
    ax4.axhline(y=0, color='gray', linestyle='-', alpha=0.3)
    ax4.axvline(x=0, color='gray', linestyle='-', alpha=0.3)
    ax4.legend()

    # 5. Sample Info Text
    ax5 = fig.add_subplot(2, 3, 5)
    ax5.axis('off')
    info_text = f"""
    SAMPLE INFORMATION
    ─────────────────────────────

    Position (X, Y, Z):
      X: {pos[0]:.2f} m
      Y: {pos[1]:.2f} m
      Z: {pos[2]:.2f} m (barometer)

    Orientation:
      Yaw: {orient[0]:.2f} rad ({np.degrees(orient[0]):.1f}°)
      Pitch: {orient[1]:.2f} rad ({np.degrees(orient[1]):.1f}°)

    Acoustic:
      STFT shape: {stft.shape}
      Time bins: {stft.shape[0]}
      Freq bins: {stft.shape[1]}

    RF (BLE):
      Beacons: {sample['rf_beacon_count']}
      Strongest: {rssi[0]:.0f} dBm
      Weakest active: {rssi[max(0, int(sample['rf_beacon_count'])-1)]:.0f} dBm
    """
    ax5.text(0.1, 0.9, info_text, transform=ax5.transAxes, fontsize=10,
             verticalalignment='top', fontfamily='monospace',
             bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.5))

    # 6. Frequency Content
    ax6 = fig.add_subplot(2, 3, 6)
    mean_spectrum = np.mean(stft, axis=0)
    ax6.plot(mean_spectrum, 'b-', linewidth=0.5)
    ax6.fill_between(range(len(mean_spectrum)), mean_spectrum, alpha=0.3)
    ax6.set_xlabel('Frequency Bin')
    ax6.set_ylabel('Mean Magnitude')
    ax6.set_title('Average Frequency Content')
    ax6.set_xlim(0, len(mean_spectrum))

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"Saved to {save_path}")

    return fig


def visualize_trajectory(samples, save_path=None):
    """Visualize the trajectory of all collected samples."""
    fig = plt.figure(figsize=(14, 6))
    fig.suptitle(f"Data Collection Trajectory ({len(samples)} samples)", fontsize=14, fontweight='bold')

    # Extract positions
    positions = np.array([s['listener_pos'] for s in samples])
    orientations = np.array([s['orientation'] for s in samples])
    rf_counts = np.array([s['rf_beacon_count'] for s in samples])

    # 2D trajectory
    ax1 = fig.add_subplot(1, 2, 1)
    scatter = ax1.scatter(positions[:, 0], positions[:, 1], c=range(len(positions)),
                          cmap='viridis', s=20, alpha=0.7)
    ax1.plot(positions[:, 0], positions[:, 1], 'k-', alpha=0.2, linewidth=0.5)
    ax1.scatter(positions[0, 0], positions[0, 1], c='green', s=100, marker='s', label='Start', zorder=5)
    ax1.scatter(positions[-1, 0], positions[-1, 1], c='red', s=100, marker='s', label='End', zorder=5)
    ax1.set_xlabel('X Position (m)')
    ax1.set_ylabel('Y Position (m)')
    ax1.set_title('2D Movement Path')
    ax1.legend()
    ax1.set_aspect('equal')
    plt.colorbar(scatter, ax=ax1, label='Sample Index')
    ax1.grid(True, alpha=0.3)

    # 3D trajectory with height
    ax2 = fig.add_subplot(1, 2, 2, projection='3d')
    scatter3d = ax2.scatter(positions[:, 0], positions[:, 1], positions[:, 2],
                            c=rf_counts, cmap='RdYlGn', s=20, alpha=0.7)
    ax2.set_xlabel('X (m)')
    ax2.set_ylabel('Y (m)')
    ax2.set_zlabel('Z (m) - Barometer')
    ax2.set_title('3D Position (color = RF beacon count)')
    plt.colorbar(scatter3d, ax=ax2, label='BLE Beacons', shrink=0.6)

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"Saved to {save_path}")

    return fig


def visualize_rf_patterns(samples, save_path=None):
    """Visualize RF patterns across all samples."""
    fig = plt.figure(figsize=(14, 8))
    fig.suptitle("RF (BLE) Patterns Across All Samples", fontsize=14, fontweight='bold')

    # Collect all RF data
    rf_data = np.array([s['rf_rssi'] for s in samples])
    rf_counts = np.array([s['rf_beacon_count'] for s in samples])

    # 1. RF heatmap across samples
    ax1 = fig.add_subplot(2, 2, 1)
    im1 = ax1.imshow(rf_data.T, aspect='auto', cmap='RdYlGn', vmin=-100, vmax=-40)
    ax1.set_xlabel('Sample Index')
    ax1.set_ylabel('Beacon Index')
    ax1.set_title('RF RSSI Heatmap (all samples)')
    plt.colorbar(im1, ax=ax1, label='RSSI (dBm)')

    # 2. Beacon count distribution
    ax2 = fig.add_subplot(2, 2, 2)
    ax2.hist(rf_counts, bins=range(0, 18), edgecolor='black', alpha=0.7)
    ax2.axvline(rf_counts.mean(), color='red', linestyle='--', label=f'Mean: {rf_counts.mean():.1f}')
    ax2.set_xlabel('Number of BLE Beacons')
    ax2.set_ylabel('Frequency')
    ax2.set_title('Beacon Count Distribution')
    ax2.legend()

    # 3. RSSI distribution by beacon
    ax3 = fig.add_subplot(2, 2, 3)
    active_rssi = rf_data[rf_data > -100]
    ax3.hist(active_rssi.flatten(), bins=50, edgecolor='black', alpha=0.7)
    ax3.set_xlabel('RSSI (dBm)')
    ax3.set_ylabel('Frequency')
    ax3.set_title('RSSI Value Distribution (active beacons only)')

    # 4. RF pattern variance
    ax4 = fig.add_subplot(2, 2, 4)
    rf_variance = np.var(rf_data, axis=0)
    ax4.bar(range(16), rf_variance)
    ax4.set_xlabel('Beacon Index')
    ax4.set_ylabel('Variance')
    ax4.set_title('RF Signal Variance by Beacon Position')

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"Saved to {save_path}")

    return fig


def visualize_acoustic_patterns(samples, save_path=None):
    """Visualize acoustic patterns across samples."""
    fig = plt.figure(figsize=(14, 8))
    fig.suptitle("Acoustic Patterns Across All Samples", fontsize=14, fontweight='bold')

    # Get sample STFTs
    n_samples = min(100, len(samples))
    sample_indices = np.linspace(0, len(samples)-1, n_samples, dtype=int)

    # 1. Mean STFT
    ax1 = fig.add_subplot(2, 2, 1)
    mean_stft = np.mean([samples[i]['stft_mag'] for i in sample_indices[:20]], axis=0)
    im1 = ax1.imshow(mean_stft.T, aspect='auto', origin='lower', cmap='magma')
    ax1.set_xlabel('Time Frame')
    ax1.set_ylabel('Frequency Bin')
    ax1.set_title('Mean STFT Magnitude (first 20 samples)')
    plt.colorbar(im1, ax=ax1)

    # 2. STFT variance
    ax2 = fig.add_subplot(2, 2, 2)
    stft_var = np.var([samples[i]['stft_mag'] for i in sample_indices[:20]], axis=0)
    im2 = ax2.imshow(stft_var.T, aspect='auto', origin='lower', cmap='viridis')
    ax2.set_xlabel('Time Frame')
    ax2.set_ylabel('Frequency Bin')
    ax2.set_title('STFT Variance (where patterns differ)')
    plt.colorbar(im2, ax=ax2)

    # 3. Average spectrum per sample
    ax3 = fig.add_subplot(2, 2, 3)
    for i in sample_indices[::10]:
        spectrum = np.mean(samples[i]['stft_mag'], axis=0)
        ax3.plot(spectrum, alpha=0.5, linewidth=0.5)
    ax3.set_xlabel('Frequency Bin')
    ax3.set_ylabel('Mean Magnitude')
    ax3.set_title('Spectral Profiles (every 10th sample)')

    # 4. Time-averaged magnitude distribution
    ax4 = fig.add_subplot(2, 2, 4)
    all_mags = np.concatenate([samples[i]['stft_mag'].flatten() for i in sample_indices[:50]])
    ax4.hist(all_mags, bins=50, edgecolor='black', alpha=0.7)
    ax4.set_xlabel('Log Magnitude')
    ax4.set_ylabel('Frequency')
    ax4.set_title('Magnitude Distribution')

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"Saved to {save_path}")

    return fig


def main():
    parser = argparse.ArgumentParser(description="Visualize NAF training data")
    parser.add_argument('--data-dir', type=str, default='training_data',
                        help='Path to training data directory')
    parser.add_argument('--output-dir', type=str, default='visualizations',
                        help='Output directory for plots')
    parser.add_argument('--show', action='store_true', help='Show plots interactively')
    args = parser.parse_args()

    # Create output directory
    output_path = Path(args.output_dir)
    output_path.mkdir(exist_ok=True)

    # Load samples
    print(f"Loading samples from {args.data_dir}...")
    samples = load_all_samples(args.data_dir)
    print(f"Loaded {len(samples)} samples")

    if len(samples) == 0:
        print("No samples found!")
        return

    # Generate visualizations
    print("\nGenerating visualizations...")

    # 1. Single sample view
    print("1. Single sample view...")
    visualize_single_sample(samples[len(samples)//2],
                           save_path=output_path / "01_single_sample.png")

    # 2. Trajectory
    print("2. Collection trajectory...")
    visualize_trajectory(samples,
                        save_path=output_path / "02_trajectory.png")

    # 3. RF patterns
    print("3. RF patterns...")
    visualize_rf_patterns(samples,
                         save_path=output_path / "03_rf_patterns.png")

    # 4. Acoustic patterns
    print("4. Acoustic patterns...")
    visualize_acoustic_patterns(samples,
                               save_path=output_path / "04_acoustic_patterns.png")

    print(f"\n✅ Visualizations saved to {output_path}/")

    if args.show:
        plt.show()


if __name__ == "__main__":
    main()
