"""
Keyboard handler for push-to-record feature
"""
import logging
import threading
from typing import Callable, Optional, Set
from pynput import keyboard
from config import KEYBOARD_ENABLED, RECORD_KEY

logger = logging.getLogger(__name__)


class KeyboardHandler:
    """Handles keyboard input for push-to-record functionality"""

    def __init__(self,
                 on_key_press: Callable[[], None],
                 on_key_release: Callable[[], None],
                 record_key: str = RECORD_KEY):
        self.on_key_press = on_key_press
        self.on_key_release = on_key_release
        self.record_key = record_key
        self.listener: Optional[keyboard.Listener] = None
        self.is_running = False
        self._key_pressed = False

        self._key_map = {
            'space': keyboard.Key.space,
            'ctrl': keyboard.Key.ctrl, 'ctrl_l': keyboard.Key.ctrl_l, 'ctrl_r': keyboard.Key.ctrl_r,
            'alt': keyboard.Key.alt, 'alt_l': keyboard.Key.alt_l, 'alt_r': keyboard.Key.alt_r,
            'shift': keyboard.Key.shift, 'shift_l': keyboard.Key.shift_l, 'shift_r': keyboard.Key.shift_r,
            'cmd': keyboard.Key.cmd, 'cmd_l': keyboard.Key.cmd_l, 'cmd_r': keyboard.Key.cmd_r,
            'l': 'l',
            'a': 'a', 'b': 'b', 'c': 'c', 'd': 'd', 'e': 'e', 'f': 'f', 'g': 'g',
            'h': 'h', 'i': 'i', 'j': 'j', 'k': 'k', 'm': 'm', 'n': 'n', 'o': 'o',
            'p': 'p', 'q': 'q', 'r': 'r', 's': 's', 't': 't', 'u': 'u', 'v': 'v',
            'w': 'w', 'x': 'x', 'y': 'y', 'z': 'z',
        }

        self._parse_key_combination(record_key)
        self._pressed_keys: Set = set()

    def _parse_key_combination(self, key_string: str):
        keys = [k.strip().lower() for k in key_string.split('+')]
        self._required_keys = []
        for key_name in keys:
            if key_name in self._key_map:
                self._required_keys.append((key_name, self._key_map[key_name]))
            elif len(key_name) == 1:
                self._required_keys.append((key_name, key_name))
            else:
                logger.warning(f"Unknown key '{key_name}', defaulting to space")
                self._required_keys.append(('space', keyboard.Key.space))
        if not self._required_keys:
            self._required_keys = [('space', keyboard.Key.space)]

    def _normalize_key(self, key):
        try:
            if hasattr(key, 'value'):
                return key
            if hasattr(key, 'char') and key.char:
                return key.char.lower()
            if hasattr(key, 'name'):
                return key.name.lower()
        except Exception:
            pass
        return key

    def _check_combination_pressed(self):
        if len(self._pressed_keys) < len(self._required_keys):
            return False
        for _, key_obj in self._required_keys:
            found = False
            for pressed_key in self._pressed_keys:
                normalized_required = self._normalize_key(key_obj)
                if isinstance(normalized_required, str) and len(normalized_required) == 1:
                    if hasattr(pressed_key, 'char') and pressed_key.char:
                        if pressed_key.char.lower() == normalized_required:
                            found = True
                            break
                elif self._normalize_key(pressed_key) == normalized_required:
                    found = True
                    break
                elif hasattr(pressed_key, 'name') and hasattr(key_obj, 'name'):
                    if pressed_key.name == key_obj.name:
                        found = True
                        break
            if not found:
                return False
        return True

    def _on_press(self, key):
        try:
            self._pressed_keys.add(key)
            if self._check_combination_pressed() and not self._key_pressed:
                self._key_pressed = True
                logger.info(f"🎤 Record key ({self.record_key}) pressed — starting recording")
                try:
                    self.on_key_press()
                except Exception as e:
                    logger.error(f"Error in on_key_press callback: {e}")
        except Exception as e:
            logger.error(f"Error handling key press: {e}")

    def _on_release(self, key):
        try:
            self._pressed_keys.discard(key)
            key_in_combination = False
            for _, key_obj in self._required_keys:
                normalized_required = self._normalize_key(key_obj)
                if isinstance(normalized_required, str) and len(normalized_required) == 1:
                    if hasattr(key, 'char') and key.char and key.char.lower() == normalized_required:
                        key_in_combination = True
                        break
                elif self._normalize_key(key) == normalized_required:
                    key_in_combination = True
                    break
                elif hasattr(key, 'name') and hasattr(key_obj, 'name') and key.name == key_obj.name:
                    key_in_combination = True
                    break

            if key_in_combination and self._key_pressed:
                self._key_pressed = False
                logger.info(f"🎤 Record key ({self.record_key}) released — stopping recording")
                try:
                    self.on_key_release()
                except Exception as e:
                    logger.error(f"Error in on_key_release callback: {e}")
        except Exception as e:
            logger.error(f"Error handling key release: {e}")

    def start(self):
        if not KEYBOARD_ENABLED:
            logger.info("Keyboard handler is disabled in configuration")
            return
        if self.is_running:
            return
        try:
            self.listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
            self.listener.start()
            self.is_running = True
            logger.info(f"Keyboard handler started — hold '{self.record_key}' to record")
        except Exception as e:
            logger.error(f"Failed to start keyboard listener: {e}")
            logger.error("macOS: grant accessibility permissions in System Preferences > Privacy > Accessibility")
            self.is_running = False
            raise

    def stop(self):
        if not self.is_running:
            return
        try:
            if self.listener:
                self.listener.stop()
                self.listener = None
            self.is_running = False
            self._key_pressed = False
            logger.info("Keyboard handler stopped")
        except Exception as e:
            logger.error(f"Error stopping keyboard listener: {e}")
