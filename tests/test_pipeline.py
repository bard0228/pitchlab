import json
import math
import struct
import tempfile
import unittest
import wave
import zipfile
from pathlib import Path

import numpy as np

from pipeline.process_song import (
    YouTubeBlockedError,
    align_plain_lyrics_to_segments,
    check_youtube_stderr,
    extract_pitch_curve,
    process_audio_to_package,
    segments_to_lrc,
)


def write_synthetic_song_wav(path: Path, sample_rate: int = 48000, duration_sec: float = 10.0):
    n = int(sample_rate * duration_sec)
    t = np.arange(n, dtype=np.float64) / sample_rate

    # Low-frequency instrumental bass/chord (around 110 Hz A2)
    inst = 0.25 * np.sin(2 * np.pi * 110.0 * t) + 0.15 * np.sin(2 * np.pi * 164.81 * t)

    # Vocal melody: silence -> C4 (261.63) -> D4 (293.66) -> E4 (329.63) -> silence
    vocal = np.zeros(n, dtype=np.float64)
    segments = [
        (1.0, 3.0, 261.625565),  # C4
        (3.5, 5.5, 293.664768),  # D4
        (6.0, 8.0, 329.627557),  # E4
    ]
    for s, e, freq in segments:
        mask = (t >= s) & (t < e)
        vocal[mask] = 0.45 * np.sin(2 * np.pi * freq * t[mask])

    mono = np.clip(inst + vocal, -0.95, 0.95)
    stereo = np.stack([mono, mono], axis=1)
    pcm = (stereo * 32767).astype(np.int16)

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


class TestPipelineSeam(unittest.TestCase):
    def test_extract_pitch_curve_accuracy_and_silence_null(self):
        sr = 48000
        dur = 5.0
        n = int(sr * dur)
        t = np.arange(n, dtype=np.float64) / sr
        sig = np.zeros(n, dtype=np.float32)
        # C4 from 1.0 to 2.0s, D4 from 2.5 to 3.5s
        sig[(t >= 1.0) & (t < 2.0)] = 0.4 * np.sin(2 * np.pi * 261.6256 * t[(t >= 1.0) & (t < 2.0)])
        sig[(t >= 2.5) & (t < 3.5)] = 0.4 * np.sin(2 * np.pi * 293.6648 * t[(t >= 2.5) & (t < 3.5)])

        curve = extract_pitch_curve(sig, sr, hop_ms=10)
        self.assertEqual(curve["hopMs"], 10)
        f0 = curve["f0Hz"]

        # Silent start must be None
        self.assertTrue(all(v is None for v in f0[10:80]))

        # C4 segment middle (1.2s..1.8s -> frames 120..180) within 15 cents
        c4_vals = [v for v in f0[120:180] if v is not None]
        self.assertGreater(len(c4_vals), 40)
        med_c4 = float(np.median(c4_vals))
        cents_err = abs(1200 * math.log2(med_c4 / 261.6256))
        self.assertLess(cents_err, 15.0)

        # D4 segment middle (2.7s..3.3s -> frames 270..330) within 15 cents
        d4_vals = [v for v in f0[270:330] if v is not None]
        self.assertGreater(len(d4_vals), 40)
        med_d4 = float(np.median(d4_vals))
        cents_err_d4 = abs(1200 * math.log2(med_d4 / 293.6648))
        self.assertLess(cents_err_d4, 15.0)

    def test_youtube_bot_wall_raises_without_bypass(self):
        with self.assertRaises(YouTubeBlockedError):
            check_youtube_stderr("ERROR: [youtube] Sign in to confirm you're not a bot.")
        with self.assertRaises(YouTubeBlockedError):
            check_youtube_stderr("ERROR: HTTP Error 403: Forbidden")
        # Normal output should not raise
        check_youtube_stderr("[download] 100% of 4.21MiB")

    def test_process_audio_to_package_creates_aligned_stems_and_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            src_wav = tmp_dir / "synthetic.wav"
            out_zip = tmp_dir / "synthetic.zip"
            write_synthetic_song_wav(src_wav, sample_rate=48000, duration_sec=10.0)

            meta = process_audio_to_package(
                source_path=src_wav,
                out_zip=out_zip,
                title="測試合成曲",
                artist="測試",
                separator="spectral",
            )
            self.assertTrue(out_zip.exists())
            self.assertLess(meta["stemDurationDiffMs"], 20.0)

            with zipfile.ZipFile(out_zip, "r") as zf:
                names = set(zf.namelist())
                self.assertTrue({"meta.json", "pitch.json", "inst.opus", "vocal.opus"}.issubset(names))
                pitch_data = json.loads(zf.read("pitch.json").decode("utf-8"))
                self.assertEqual(pitch_data["hopMs"], 10)
                # Verify C4 around 2.0s (frame 200) and E4 around 7.0s (frame 700)
                c4_slice = [v for v in pitch_data["f0Hz"][150:250] if v is not None]
                self.assertGreater(len(c4_slice), 50)
                c4_err = abs(1200 * math.log2(float(np.median(c4_slice)) / 261.6256))
                self.assertLess(c4_err, 15.0)

                e4_slice = [v for v in pitch_data["f0Hz"][650:750] if v is not None]
                self.assertGreater(len(e4_slice), 50)
                e4_err = abs(1200 * math.log2(float(np.median(e4_slice)) / 329.6276))
                self.assertLess(e4_err, 15.0)

    def test_segments_to_lrc_and_plain_text_alignment(self):
        segs = [
            {"start": 1.25, "end": 4.0, "text": "辨識句一"},
            {"start": 4.5, "end": 8.0, "text": "辨識句二"},
        ]
        lrc = segments_to_lrc(segs)
        self.assertIn("[00:01.25]辨識句一", lrc)
        self.assertIn("[00:04.50]辨識句二", lrc)

        plain = ["正確歌詞第一行", "正確歌詞第二行", "正確歌詞第三行", "正確歌詞第四行"]
        aligned = align_plain_lyrics_to_segments(plain, segs, duration_sec=10.0)
        lines = [line for line in aligned.splitlines() if line.strip()]
        self.assertEqual(len(lines), 4)
        self.assertIn("正確歌詞第一行", lines[0])
        self.assertIn("正確歌詞第四行", lines[3])

    def test_process_audio_to_package_embeds_lrc_when_provided(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            src_wav = tmp_dir / "synthetic.wav"
            lrc_file = tmp_dir / "lyrics.lrc"
            out_zip = tmp_dir / "with_lrc.zip"
            write_synthetic_song_wav(src_wav, sample_rate=48000, duration_sec=6.0)
            lrc_file.write_text("[00:01.00]測試歌詞\n", encoding="utf-8")

            meta = process_audio_to_package(
                source_path=src_wav,
                out_zip=out_zip,
                title="歌詞測試",
                separator="spectral",
                lrc_path=lrc_file,
            )
            self.assertTrue(meta["hasLyrics"])
            with zipfile.ZipFile(out_zip, "r") as zf:
                self.assertIn("lyrics.lrc", zf.namelist())
                self.assertIn("測試歌詞", zf.read("lyrics.lrc").decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
