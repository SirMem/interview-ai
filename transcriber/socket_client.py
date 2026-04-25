"""
Socket.IO client for sending transcription chunks and questions.

Improvements over the original:
- Unlimited reconnection attempts (reconnection_attempts=0) with up to 30s max delay.
- Background retry thread for initial connection failures (server not yet running).
"""
import threading
import time
import socketio
import logging
from typing import Optional
from config import SOCKET_URL, SOCKET_ENDPOINT

logger = logging.getLogger(__name__)


class SocketClient:
    """Socket.IO client with automatic infinite reconnection."""

    def __init__(self, url: str = SOCKET_URL, endpoint: str = SOCKET_ENDPOINT):
        self.url = url
        self.endpoint = endpoint
        self.use_namespace = False
        self.connected = False
        self._reconnect_thread: Optional[threading.Thread] = None

        # reconnection_attempts=0 means unlimited built-in reconnection after disconnect.
        # reconnection_delay_max=30 caps the exponential backoff at 30 s.
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=1,
            reconnection_delay_max=30,
        )

        self.sio.on('connect', self._on_connect, namespace=self.endpoint)
        self.sio.on('disconnect', self._on_disconnect, namespace=self.endpoint)
        self.sio.on('connect_error', self._on_connect_error, namespace=self.endpoint)

        self.sio.on('ai_processing_started', self._on_ai_processing_started, namespace=self.endpoint)
        self.sio.on('ai_processing_complete', self._on_ai_processing_complete, namespace=self.endpoint)
        self.sio.on('ai_token', self._on_ai_token, namespace=self.endpoint)
        self.sio.on('aiprocessing_error', self._on_ai_processing_error, namespace=self.endpoint)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def _on_connect(self):
        self.connected = True
        logger.info(f"Connected to {self.url} on namespace {self.endpoint}")

    def _on_disconnect(self):
        self.connected = False
        logger.info(f"Disconnected from namespace {self.endpoint}")

    def _on_connect_error(self, error):
        logger.error(f"Socket.IO connection error: {error}")
        self.connected = False

    def _on_ai_processing_started(self, data):
        message = data.get('message', 'AI processing started') if isinstance(data, dict) else str(data)
        logger.info(f"🤖 AI Processing Started: {message}")
        print(f"\n🤖 AI Processing Started: {message}\n")

    def _on_ai_token(self, data):
        """Handle streaming token — print live."""
        token = data.get('token', '') if isinstance(data, dict) else str(data)
        if token:
            print(token, end='', flush=True)

    def _on_ai_processing_complete(self, data):
        if isinstance(data, dict):
            message = data.get('message', 'AI processing completed')
        else:
            message = 'AI processing completed'

        logger.info(f"✅ AI Processing Complete: {message}")
        print(f"\n{'=' * 80}")
        print(f"✅ {message}")
        print(f"{'=' * 80}\n")

    def _on_ai_processing_error(self, data):
        if isinstance(data, dict):
            error = data.get('error', 'Unknown error')
            message = data.get('message', 'AI processing error')
        else:
            error = str(data)
            message = 'AI processing error'

        logger.error(f"❌ AI Processing Error: {message} — {error}")
        print(f"\n❌ AI Processing Error: {message}\nDetails: {error}\n")

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect(self):
        """Attempt immediate connection. On failure, start background retry loop."""
        if self.connected:
            return

        logger.info(f"Connecting to {self.url} on namespace {self.endpoint}")
        try:
            self.sio.connect(
                self.url,
                transports=['websocket'],
                namespaces=[self.endpoint],
            )
            self.use_namespace = True
        except Exception as e:
            logger.warning(f"Initial connection failed: {e}. Background reconnect started.")
            self._start_background_reconnect()

    def _start_background_reconnect(self):
        """Spawn a daemon thread that retries the connection with exponential backoff."""
        if self._reconnect_thread and self._reconnect_thread.is_alive():
            return
        self._reconnect_thread = threading.Thread(
            target=self._reconnect_loop,
            daemon=True,
            name="socket-reconnect",
        )
        self._reconnect_thread.start()

    def _reconnect_loop(self):
        """Keep trying to connect with exponential backoff (1 s → 2 s → … → 30 s max)."""
        delay = 1
        max_delay = 30
        attempt = 0

        while not self.connected:
            time.sleep(delay)
            delay = min(delay * 2, max_delay)

            if self.connected:
                break

            attempt += 1
            logger.info(f"Socket.IO reconnect attempt {attempt}…")
            try:
                self.sio.connect(
                    self.url,
                    transports=['websocket'],
                    namespaces=[self.endpoint],
                )
                self.use_namespace = True
                logger.info("Socket.IO reconnected successfully")
                break
            except Exception as e:
                logger.warning(f"Reconnect attempt {attempt} failed: {e}. Next in {delay}s")

    def disconnect(self):
        if not self.connected:
            return
        try:
            self.sio.disconnect()
            self.connected = False
            logger.info("Disconnected from Socket.IO server")
        except Exception as e:
            logger.error(f"Error disconnecting: {e}")

    # ------------------------------------------------------------------
    # Emitters
    # ------------------------------------------------------------------

    def send_stt_partial(self, committed: str, tentative: str):
        """Emit streaming partial transcript — committed (stable) + tentative (may change).
        Called ~every 300ms while the speaker is talking.
        """
        if not self.connected:
            return
        try:
            self.sio.emit('stt_partial', {
                'committed': committed,
                'tentative': tentative,
                'timestamp': time.time(),
            }, namespace=self.endpoint)
        except Exception as e:
            logger.error(f"Error sending stt_partial: {e}")

    def send_stt_final(self, text: str, uid=None, silence_started_at=None):
        """Emit final confirmed transcript. Triggers AI answer on the Node side.

        `uid` and `silence_started_at` (Fix #8) are propagated so Node can
        compose the end_to_end_question_ms histogram by computing the delta
        between silence-detected (here) and first-AI-token (in dataHandler).
        """
        if not self.connected:
            return
        if not text or not text.strip():
            return
        try:
            payload = {
                'text': text.strip(),
                'timestamp': time.time(),
            }
            if uid is not None:
                payload['uid'] = uid
            if silence_started_at is not None:
                payload['silence_started_at'] = silence_started_at
            self.sio.emit('stt_final', payload, namespace=self.endpoint)
            logger.info(f"Sent stt_final: {text[:80]}… uid=%s", str(uid)[:8] if uid else 'none')
        except Exception as e:
            logger.error(f"Error sending stt_final: {e}")

    def send_speaker_id_status(self, status: str):
        """Emit speaker_id_unavailable — Node relays to HUD for the warning banner.

        status: 'load_failed' | 'not_enrolled'  (anything else is ignored)
        """
        if status not in ('load_failed', 'not_enrolled'):
            return
        if not self.connected:
            return
        try:
            self.sio.emit('speaker_id_unavailable', {
                'reason': status,
                'timestamp': time.time(),
            }, namespace=self.endpoint)
            logger.info("Sent speaker_id_unavailable: %s", status)
        except Exception as e:
            logger.error("Error sending speaker_id_unavailable: %s", e)

    def send_listen_state(self, listening: bool):
        """Notify Node.js that the always-on listener was toggled via keyboard."""
        if not self.connected:
            return
        try:
            self.sio.emit('listen_state_update', {'listening': listening}, namespace=self.endpoint)
            logger.debug(f"Sent listen_state_update: {listening}")
        except Exception as e:
            logger.error(f"Error sending listen state: {e}")

    def is_connected(self) -> bool:
        return self.connected

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
