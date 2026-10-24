import subprocess
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from fastapi import HTTPException, UploadFile

from scripts.asr import http_asr_server


def upload(filename: str, size: int = 1200) -> UploadFile:
    return UploadFile(file=BytesIO(b"a" * size), filename=filename)


class HttpAsrServerTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.original_model = http_asr_server.asr_model

    def tearDown(self) -> None:
        http_asr_server.asr_model = self.original_model

    async def test_rejects_requests_until_the_model_is_ready(self) -> None:
        http_asr_server.asr_model = None

        with self.assertRaises(HTTPException) as raised:
            await http_asr_server.transcribe(upload("recording.wav"))

        self.assertEqual(raised.exception.status_code, 503)

    async def test_rejects_tiny_complete_files(self) -> None:
        http_asr_server.asr_model = Mock()
        with self.assertRaises(HTTPException) as raised:
            await http_asr_server.transcribe(
                upload("recording.wav", http_asr_server.MIN_AUDIO_BYTES - 1)
            )
        self.assertEqual(raised.exception.status_code, 400)

    async def test_accepts_complete_files_larger_than_twenty_megabytes(self) -> None:
        http_asr_server.asr_model = Mock()
        http_asr_server.asr_model.generate.return_value = [{"text": "大文件转写"}]
        response = await http_asr_server.transcribe(
            upload("recording.wav", 21 * 1024 * 1024)
        )
        http_asr_server.asr_model.generate.assert_called_once()
        self.assertIn("大文件转写", response.body.decode("utf-8"))

    async def test_wav_file_skips_ffmpeg(self) -> None:
        http_asr_server.asr_model = Mock()
        http_asr_server.asr_model.generate.return_value = [{"text": "本地转写"}]

        with patch.object(http_asr_server, "convert_to_wav") as convert:
            response = await http_asr_server.transcribe(upload("recording.wav"))

        convert.assert_not_called()
        self.assertIn("本地转写", response.body.decode("utf-8"))

    async def test_complete_webm_file_uses_ffmpeg(self) -> None:
        http_asr_server.asr_model = Mock()
        http_asr_server.asr_model.generate.return_value = [{"text": "文件转写"}]

        with patch.object(http_asr_server, "convert_to_wav") as convert:
            response = await http_asr_server.transcribe(upload("recording.webm"))

        convert.assert_called_once()
        self.assertIn("文件转写", response.body.decode("utf-8"))

    async def test_maps_ffmpeg_failure_to_http_error(self) -> None:
        http_asr_server.asr_model = Mock()
        failure = subprocess.CalledProcessError(1, ["ffmpeg"], stderr="invalid input")

        with patch.object(http_asr_server, "convert_to_wav", side_effect=failure):
            with self.assertRaises(HTTPException) as raised:
                await http_asr_server.transcribe(upload("recording.webm"))

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, "ffmpeg conversion failed: invalid input")


if __name__ == "__main__":
    unittest.main()
