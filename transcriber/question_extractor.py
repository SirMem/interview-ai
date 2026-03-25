"""
Pattern-based question extraction
"""
import re
import logging
from typing import List, Tuple
from config import QUESTION_WORDS, QUESTION_PATTERNS, QUESTION_PATTERN_CONFIDENCE_THRESHOLD

logger = logging.getLogger(__name__)


class QuestionExtractor:
    """Pattern-based question extractor"""

    def __init__(self):
        self.pattern_confidence_threshold = QUESTION_PATTERN_CONFIDENCE_THRESHOLD

    def _pattern_detect(self, text: str) -> Tuple[bool, float]:
        if not text or not text.strip():
            return False, 0.0
        text_lower = text.lower().strip()
        confidence = 0.0
        if text.rstrip().endswith('?'):
            confidence += 0.4
        words = text_lower.split()
        if words:
            first_word = words[0].rstrip('?.,!;:')
            if first_word in QUESTION_WORDS:
                confidence += 0.3
            first_three = ' '.join(words[:3])
            for qword in QUESTION_WORDS:
                if qword in first_three:
                    confidence += 0.1
                    break
        for pattern in QUESTION_PATTERNS:
            if pattern in text_lower:
                confidence += 0.2
                break
        aux_verbs = ['is', 'are', 'was', 'were', 'do', 'does', 'did',
                     'can', 'could', 'would', 'should', 'will', 'shall', 'have', 'has', 'had']
        if words and words[0] in aux_verbs:
            confidence += 0.2
        confidence = min(confidence, 1.0)
        return confidence >= self.pattern_confidence_threshold, confidence

    def extract_questions(self, text: str) -> List[str]:
        if not text:
            return []
        questions = []
        for sentence in self._split_sentences(text):
            sentence = sentence.strip()
            if not sentence:
                continue
            is_q, _ = self._pattern_detect(sentence)
            if is_q:
                questions.append(sentence)
        return questions

    def is_question(self, text: str) -> Tuple[bool, float]:
        if not text:
            return False, 0.0
        return self._pattern_detect(text)

    def _split_sentences(self, text: str) -> List[str]:
        sentences = re.split(r'[.!?]+\s+', text)
        all_sentences = []
        for sent in sentences:
            all_sentences.extend(sent.split('\n'))
        return [s.strip() for s in all_sentences if s.strip()]
