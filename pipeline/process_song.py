#!/usr/bin/env python3
"""
台灣好聲音（PitchLab）離線 AI 分軌與 Target Pitch Curve 萃取管線
支援：
1. 本機音檔（MP3 / WAV / M4A）
2. 選用 YouTube 網址（遇人機驗證、403 或私人影片立即停止，絕不繞過風控）
3. Demucs AI 兩軌分離（伴奏 inst.opus + 原人聲 vocal.opus），無 GPU/Demucs 環境可自動或手動切換至 spectral 輕量分離
4. FFT 加速 YIN 萃取 Target Pitch Curve（pitch.json，靜音與低信心度自動設為 null）
5. 封裝為標準 Song Package .zip，可直接匯入 PWA 離線歌庫或同步 Google Drive
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import wave
from zoneinfo import ZoneInfo
import zipfile

import numpy as np


TAIPEI_TZ = ZoneInfo("Asia/Taipei")

YOUTUBE_BLOCK_PATTERNS = [
    r"sign in to confirm you'?re not a bot",
    r"confirm you are not a bot",
    r"http error 403",
    r"private video",
    r"members-only",
    r"captcha",
    r"age-restricted",
]


class YouTubeBlockedError(RuntimeError):
    """Raised when YouTube enforces bot/captcha/access restrictions."""


def check_youtube_stderr(stderr_text: str) -> None:
    lowered = (stderr_text or "").lower()
    for pat in YOUTUBE_BLOCK_PATTERNS:
        if re.search(pat, lowered):
            raise YouTubeBlockedError(
                "YouTube 觸發風控驗證或權限限制（依規範不繞過驗證），請改用本機 MP3 / WAV / M4A 音檔。"
            )


def download_youtube_audio(url: str, out_dir: Path) -> tuple[Path, str]:
    yt_dlp_bin = shutil.which("yt-dlp")
    if not yt_dlp_bin:
        raise RuntimeError("找不到 yt-dlp，請先執行 pip install yt-dlp 或改用本機音檔。")

    out_tpl = str(out_dir / "yt_source.%(ext)s")
    cmd = [
        yt_dlp_bin,
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--print",
        "after_move:filepath",
        "--print",
        "title",
        "-o",
        out_tpl,
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    check_youtube_stderr(proc.stderr + "\n" + proc.stdout)
    if proc.returncode != 0:
        raise RuntimeError(f"YouTube 下載失敗：{proc.stderr.strip() or proc.stdout.strip()}")

    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    title = lines[0] if lines else "YouTube 匯入曲目"
    candidates = sorted(out_dir.glob("yt_source.*"))
    if not candidates:
        raise RuntimeError("yt-dlp 未產出音訊檔，請改用本機音檔。")
    return candidates[0], title


def run_ffmpeg_normalize(input_path: Path, out_wav: Path, sample_rate: int = 48000) -> None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("找不到 ffmpeg，請先安裝 ffmpeg。")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "2",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(out_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 轉檔失敗：{proc.stderr.strip()}")


def read_stereo_wav(wav_path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(wav_path), "rb") as wf:
        channels = wf.getnchannels()
        sr = wf.getframerate()
        frames = wf.getnframes()
        raw = wf.readframes(frames)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels == 2:
        stereo = pcm.reshape(-1, 2)
    else:
        stereo = np.stack([pcm, pcm], axis=1)
    return stereo, sr


def write_stereo_wav(wav_path: Path, stereo: np.ndarray, sample_rate: int) -> None:
    clipped = np.clip(stereo, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def separate_stems_demucs(src_wav: Path, work_dir: Path) -> tuple[Path, Path]:
    demucs_bin = shutil.which("demucs")
    if not demucs_bin:
        raise RuntimeError("demucs not installed")
    out_root = work_dir / "demucs_out"
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "--two-stems=vocals",
        "-n",
        "htdemucs",
        "-o",
        str(out_root),
        str(src_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Demucs 分軌失敗：{proc.stderr.strip()}")

    model_dir = out_root / "htdemucs" / src_wav.stem
    voc_wav = model_dir / "vocals.wav"
    inst_wav = model_dir / "no_vocals.wav"
    if not voc_wav.exists() or not inst_wav.exists():
        raise RuntimeError("Demucs 未產出 vocals.wav / no_vocals.wav")
    return inst_wav, voc_wav


def separate_stems_spectral(src_wav: Path, work_dir: Path) -> tuple[Path, Path]:
    """Lightweight pure-NumPy spectral vocal/instrumental fallback for CPU/CI without Demucs."""
    stereo, sr = read_stereo_wav(src_wav)
    n = stereo.shape[0]
    mid = 0.5 * (stereo[:, 0] + stereo[:, 1])
    side = 0.5 * (stereo[:, 0] - stereo[:, 1])

    # FFT vocal-band isolation (200 Hz - 4200 Hz)
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    spec_mid = np.fft.rfft(mid)
    vocal_mask = ((freqs >= 190.0) & (freqs <= 4200.0)).astype(np.float32)

    vocal_mono = np.fft.irfft(spec_mid * vocal_mask, n=n).astype(np.float32)
    inst_mid = np.fft.irfft(spec_mid * (1.0 - vocal_mask), n=n).astype(np.float32)

    vocal_stereo = np.stack([vocal_mono, vocal_mono], axis=1)
    inst_stereo = np.stack([inst_mid + side, inst_mid - side], axis=1)

    inst_wav = work_dir / "inst_spectral.wav"
    voc_wav = work_dir / "voc_spectral.wav"
    write_stereo_wav(inst_wav, inst_stereo, sr)
    write_stereo_wav(voc_wav, vocal_stereo, sr)
    return inst_wav, voc_wav


def extract_pitch_curve(
    samples: np.ndarray,
    sample_rate: int,
    hop_ms: int = 10,
    min_freq: float = 70.0,
    max_freq: float = 1000.0,
    clarity_threshold: float = 0.85,
    rms_threshold: float = 0.012,
) -> dict:
    if samples.ndim == 2:
        mono = np.mean(samples, axis=1).astype(np.float32)
    else:
        mono = samples.astype(np.float32)

    frame_len = 2048
    hop_samples = max(1, int(round(sample_rate * hop_ms / 1000.0)))
    total_frames = max(1, int(np.ceil(len(mono) / hop_samples)))

    min_tau = max(2, int(sample_rate / max_freq))
    max_tau = min(frame_len // 2 - 1, int(np.ceil(sample_rate / min_freq)))
    half = frame_len // 2
    yin_threshold = 1.0 - clarity_threshold

    f0_list: list[float | None] = []
    conf_list: list[float] = []

    padded = np.pad(mono, (0, frame_len), mode="constant")
    fft_len = 1 << (frame_len - 1).bit_length() * 1
    if fft_len < frame_len * 2:
        fft_len *= 2

    for idx in range(total_frames):
        start = idx * hop_samples
        frame = padded[start : start + frame_len]
        rms = float(np.sqrt(np.mean(frame * frame)))
        if rms < rms_threshold or max_tau <= min_tau + 2:
            f0_list.append(None)
            conf_list.append(0.0)
            continue

        # Fast FFT-based YIN difference function over window size = half
        x1 = frame[:half]
        sq = frame * frame
        csum = np.concatenate(([0.0], np.cumsum(sq, dtype=np.float64)))
        e1 = csum[half]
        e2 = csum[half : half + max_tau + 1] - csum[0 : max_tau + 1]

        fx1 = np.fft.rfft(x1, n=fft_len)
        fx2 = np.fft.rfft(frame, n=fft_len)
        acf = np.fft.irfft(np.conj(fx1) * fx2, n=fft_len)[: max_tau + 1]

        diff = np.maximum(0.0, e1 + e2 - 2.0 * acf)
        running_sum = np.cumsum(diff[1:])
        yin = np.ones(max_tau + 1, dtype=np.float64)
        taus = np.arange(1, max_tau + 1, dtype=np.float64)
        nonzero = running_sum > 1e-12
        yin[1:][nonzero] = (diff[1:][nonzero] * taus[nonzero]) / running_sum[nonzero]

        best_tau = -1
        for tau in range(min_tau, max_tau + 1):
            if yin[tau] < yin_threshold:
                while tau + 1 <= max_tau and yin[tau + 1] < yin[tau]:
                    tau += 1
                best_tau = tau
                break

        if best_tau == -1:
            f0_list.append(None)
            conf_list.append(0.0)
            continue

        refined_tau = float(best_tau)
        if min_tau < best_tau < max_tau:
            s0, s1, s2 = yin[best_tau - 1], yin[best_tau], yin[best_tau + 1]
            denom = 2.0 * (2.0 * s1 - s2 - s0)
            if abs(denom) > 1e-12:
                refined_tau += (s2 - s0) / denom

        freq = float(sample_rate / refined_tau)
        if not (min_freq <= freq <= max_freq):
            f0_list.append(None)
            conf_list.append(0.0)
            continue

        conf = float(max(0.0, min(1.0, 1.0 - yin[best_tau])))
        f0_list.append(round(freq, 3))
        conf_list.append(round(conf, 4))

    return {"hopMs": hop_ms, "f0Hz": f0_list, "confidence": conf_list}


def probe_duration_ms(media_path: Path) -> float:
    ffprobe_bin = shutil.which("ffprobe")
    if not ffprobe_bin:
        return 0.0
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0 or not proc.stdout.strip():
        return 0.0
    return float(proc.stdout.strip()) * 1000.0


def encode_opus(in_wav: Path, out_opus: Path) -> None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("找不到 ffmpeg。")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(in_wav),
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        str(out_opus),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Opus 轉碼失敗：{proc.stderr.strip()}")


def format_lrc_timestamp(sec: float) -> str:
    safe = max(0.0, float(sec))
    mins = int(safe // 60)
    rem = safe - mins * 60
    whole_sec = int(rem)
    centi = int(round((rem - whole_sec) * 100))
    if centi >= 100:
        whole_sec += 1
        centi -= 100
    if whole_sec >= 60:
        mins += 1
        whole_sec -= 60
    return f"[{mins:02d}:{whole_sec:02d}.{centi:02d}]"


def segments_to_lrc(segments: list[dict]) -> str:
    lines: list[str] = []
    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        start = float(seg.get("start", 0.0))
        lines.append(f"{format_lrc_timestamp(start)}{text}")
    return "\n".join(lines) + ("\n" if lines else "")


def align_plain_lyrics_to_segments(
    plain_lines: list[str],
    segments: list[dict],
    duration_sec: float = 0.0,
) -> str:
    cleaned = [line.strip() for line in plain_lines if line and line.strip()]
    if not cleaned:
        return ""

    valid_segs = [
        (float(s["start"]), max(float(s["start"]) + 0.3, float(s.get("end", s["start"] + 1.0))))
        for s in segments
        if str(s.get("text", "")).strip()
    ]
    if not valid_segs:
        span = max(float(duration_sec), len(cleaned) * 2.5)
        start_t = min(1.0, span * 0.05)
        step = max(0.5, (span - start_t) / max(1, len(cleaned)))
        return "\n".join(
            f"{format_lrc_timestamp(start_t + i * step)}{line}"
            for i, line in enumerate(cleaned)
        ) + "\n"

    total_chars = sum(max(1, len(line)) for line in cleaned)
    seg_total_dur = sum(end - start for start, end in valid_segs)

    def time_at_fraction(frac: float) -> float:
        target_dur = max(0.0, min(1.0, frac)) * seg_total_dur
        acc = 0.0
        for start, end in valid_segs:
            d = end - start
            if acc + d >= target_dur or d <= 0:
                ratio = (target_dur - acc) / d if d > 0 else 0.0
                return start + ratio * d
            acc += d
        return valid_segs[-1][1]

    out_lines: list[str] = []
    char_acc = 0
    for line in cleaned:
        t = time_at_fraction(char_acc / total_chars)
        out_lines.append(f"{format_lrc_timestamp(t)}{line}")
        char_acc += max(1, len(line))
    return "\n".join(out_lines) + "\n"


def transcribe_vocal_whisper(voc_wav: Path, model_size: str = "small") -> list[dict]:
    try:
        import whisper  # type: ignore
    except ImportError as exc:
        raise RuntimeError("找不到 openai-whisper，請先執行 pip install openai-whisper。") from exc

    model = whisper.load_model(model_size)
    result = model.transcribe(
        str(voc_wav),
        initial_prompt="以下是繁體中文歌曲的歌詞：",
        fp16=False if not os.environ.get("CUDA_VISIBLE_DEVICES") and model.device.type == "cpu" else True,
    )
    return [
        {
            "start": float(seg.get("start", 0.0)),
            "end": float(seg.get("end", 0.0)),
            "text": str(seg.get("text", "")).strip(),
        }
        for seg in result.get("segments", [])
        if str(seg.get("text", "")).strip()
    ]


def process_audio_to_package(
    source_path: Path | None = None,
    youtube_url: str | None = None,
    out_zip: Path | None = None,
    title: str | None = None,
    artist: str = "",
    separator: str = "auto",
    lrc_path: Path | None = None,
    lyrics_mode: str = "none",
    lyrics_text_path: Path | None = None,
    whisper_model: str = "small",
) -> dict:
    if not source_path and not youtube_url:
        raise ValueError("必須提供本機音檔路徑或 YouTube 網址。")

    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)
        source_type = "youtube" if youtube_url else "file"

        if youtube_url:
            raw_path, yt_title = download_youtube_audio(youtube_url, work_dir)
            song_title = title or yt_title
        else:
            raw_path = Path(source_path)
            if not raw_path.exists():
                raise FileNotFoundError(f"找不到音檔：{raw_path}")
            song_title = title or raw_path.stem

        norm_wav = work_dir / "source_48k.wav"
        run_ffmpeg_normalize(raw_path, norm_wav, sample_rate=48000)

        used_sep = separator
        if separator == "auto":
            if shutil.which("demucs"):
                inst_wav, voc_wav = separate_stems_demucs(norm_wav, work_dir)
                used_sep = "demucs-htdemucs"
            else:
                inst_wav, voc_wav = separate_stems_spectral(norm_wav, work_dir)
                used_sep = "spectral-fallback"
        elif separator == "demucs":
            inst_wav, voc_wav = separate_stems_demucs(norm_wav, work_dir)
            used_sep = "demucs-htdemucs"
        else:
            inst_wav, voc_wav = separate_stems_spectral(norm_wav, work_dir)
            used_sep = "spectral-fallback"

        voc_samples, sr = read_stereo_wav(voc_wav)
        pitch_curve = extract_pitch_curve(voc_samples, sr, hop_ms=10)

        inst_opus = work_dir / "inst.opus"
        voc_opus = work_dir / "vocal.opus"
        encode_opus(inst_wav, inst_opus)
        encode_opus(voc_wav, voc_opus)

        inst_dur_ms = probe_duration_ms(inst_opus)
        voc_dur_ms = probe_duration_ms(voc_opus)
        diff_ms = abs(inst_dur_ms - voc_dur_ms)
        if diff_ms >= 20.0:
            raise RuntimeError(f"雙軌時長偏差過大：{diff_ms:.2f}ms (>= 20ms)")

        lrc_content = ""
        if lrc_path is not None:
            lrc_file = Path(lrc_path)
            if not lrc_file.exists():
                raise FileNotFoundError(f"找不到歌詞檔：{lrc_file}")
            lrc_content = lrc_file.read_text(encoding="utf-8")
        elif lyrics_mode == "whisper":
            segs = transcribe_vocal_whisper(voc_wav, model_size=whisper_model)
            lrc_content = segments_to_lrc(segs)
        elif lyrics_mode == "align" and lyrics_text_path is not None:
            txt_file = Path(lyrics_text_path)
            if not txt_file.exists():
                raise FileNotFoundError(f"找不到純文字歌詞檔：{txt_file}")
            plain_lines = txt_file.read_text(encoding="utf-8").splitlines()
            segs = transcribe_vocal_whisper(voc_wav, model_size=whisper_model)
            lrc_content = align_plain_lyrics_to_segments(
                plain_lines, segs, duration_sec=max(inst_dur_ms, voc_dur_ms) / 1000.0
            )

        meta = {
            "id": str(uuid.uuid4()),
            "title": song_title,
            "artist": artist,
            "durationMs": round(max(inst_dur_ms, voc_dur_ms), 2),
            "stemDurationDiffMs": round(diff_ms, 2),
            "sampleRate": sr,
            "sourceType": source_type,
            "separatorModel": used_sep,
            "pitchModel": "yin-fft-v1",
            "hasLyrics": bool(lrc_content.strip()),
            "createdAt": datetime.now(TAIPEI_TZ).isoformat(),
        }

        if out_zip is None:
            safe_name = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", song_title).strip("_") or "song"
            out_zip = Path.cwd() / f"{safe_name}.zip"
        out_zip = Path(out_zip)
        out_zip.parent.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
            zf.writestr("pitch.json", json.dumps(pitch_curve))
            if lrc_content.strip():
                zf.writestr("lyrics.lrc", lrc_content)
            zf.write(inst_opus, "inst.opus")
            zf.write(voc_opus, "vocal.opus")

        return meta


def main() -> int:
    parser = argparse.ArgumentParser(description="台灣好聲音（PitchLab）離線 AI 分軌與音高萃取 CLI")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input", type=Path, help="本機音檔路徑（MP3 / WAV / M4A）")
    group.add_argument("--youtube", type=str, help="選用 YouTube 影片網址（遇風控牆自動中止）")
    parser.add_argument("--out", type=Path, default=None, help="輸出 Song Package .zip 路徑")
    parser.add_argument("--title", type=str, default=None, help="歌名")
    parser.add_argument("--artist", type=str, default="", help="歌手")
    parser.add_argument(
        "--separator",
        choices=["auto", "demucs", "spectral"],
        default="auto",
        help="分軌引擎（預設 auto：優先 demucs，否則 spectral）",
    )
    parser.add_argument("--lrc", type=Path, default=None, help="選用外部 .lrc 動態歌詞檔")
    parser.add_argument(
        "--lyrics-mode",
        choices=["none", "whisper", "align"],
        default="none",
        help="歌詞自動處理模式（whisper 自動辨識 / align 對齊純文字歌詞）",
    )
    parser.add_argument("--lyrics-text", type=Path, default=None, help="純文字歌詞檔（搭配 --lyrics-mode align）")
    parser.add_argument("--whisper-model", type=str, default="small", help="Whisper 模型大小（預設 small）")
    args = parser.parse_args()

    try:
        meta = process_audio_to_package(
            source_path=args.input,
            youtube_url=args.youtube,
            out_zip=args.out,
            title=args.title,
            artist=args.artist,
            separator=args.separator,
            lrc_path=args.lrc,
            lyrics_mode=args.lyrics_mode,
            lyrics_text_path=args.lyrics_text,
            whisper_model=args.whisper_model,
        )
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        return 0
    except YouTubeBlockedError as exc:
        print(f"[BLOCKED] {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
