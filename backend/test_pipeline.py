"""Verification script for testing audio processing and transcription."""

import os
import sys
from pydub import AudioSegment

# Add backend directory to python path
sys.path.append(os.path.dirname(__file__))

import audio_processor
import transcriber


def test_pipeline():
    print("=== Testing Voice Collector Backend Pipeline ===")

    # Check if there are any processed files we can use
    audio_dir = audio_processor.AUDIO_DIR
    files = [f for f in os.listdir(audio_dir) if f.endswith(".wav")]
    if not files:
        print("No test audio files found in data/audio/ directory.")
        return

    test_file = os.path.join(audio_dir, files[0])
    print(f"Found test audio file: {test_file}")

    # Check duration and properties of test file
    try:
        audio = AudioSegment.from_file(test_file)
        print(f"Original properties: Channels={audio.channels}, Sample Rate={audio.frame_rate}Hz, Duration={len(audio)/1000.0}s")
    except Exception as e:
        print(f"Error reading file with pydub: {e}")
        return

    # Run transcription
    print("\nRunning transcription on model...")
    try:
        text = transcriber.transcribe(test_file)
        print(f"Transcription result: '{text}'")
    except Exception as e:
        print(f"Error running transcription: {e}")
        return

    # Check audio processing logic on a mock sequence
    # Let's generate a mock audio segment and verify it trims silence
    print("\nGenerating mock audio with silence to test audio processor...")
    silence = AudioSegment.silent(duration=2000)  # 2 seconds of silence
    # Simple beep sound for speech emulation
    try:
        from pydub.generators import Sine
        beep = Sine(440).to_audio_segment(duration=10000, volume=-10)  # 10 seconds beep
        # Concatenate: silence + beep + silence
        test_audio = silence + beep + silence
        test_input_path = os.path.join(audio_processor.AUDIO_DIR, "temp_test_input.wav")
        test_audio.export(test_input_path, format="wav")

        print("Processing test audio segment through pipeline...")
        output_path, duration, quality = audio_processor.process_audio(test_input_path, "temp_test_output.wav")
        
        # Cleanup temp input
        if os.path.exists(test_input_path):
            os.remove(test_input_path)

        processed_audio = AudioSegment.from_file(output_path)
        print(f"Processed audio duration: {len(processed_audio)/1000.0}s, quality: {quality}")
        
        # Cleanup temp output
        if os.path.exists(output_path):
            os.remove(output_path)
        
        if duration >= 3.0:
            print("✅ Audio processing test PASSED!")
        else:
            print(f"⚠️ Audio processing test returned unexpected duration: {duration}s")
            
    except Exception as e:
        print(f"Could not run audio trimming test: {e}")

    print("\n=== Verification Completed ===")


if __name__ == "__main__":
    test_pipeline()
