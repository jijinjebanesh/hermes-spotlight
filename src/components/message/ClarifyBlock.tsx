import React, { useEffect, useState } from 'react';
import { HelpCircle, ArrowRight, CornerDownRight, Send, Check } from 'lucide-react';

interface ClarifyBlockProps {
  question: string;
  answer?: string;
  choices?: string[];
  multiSelect?: boolean;
  onAnswer?: (answer: string | string[]) => void;
}

export const ClarifyBlock: React.FC<ClarifyBlockProps> = ({ question, answer, choices, multiSelect = false, onAnswer }) => {
  const [textAnswer, setTextAnswer] = useState('');
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);
  useEffect(() => {
    setTextAnswer('');
    setSelectedChoices([]);
    setSubmittedAnswer(null);
  }, [question]);
  const hasChoices = choices && choices.length > 0;
  const hasAnswer = Boolean(answer || submittedAnswer);

  const handleChoiceClick = (choice: string) => {
    if (multiSelect) {
      setSelectedChoices(current => current.includes(choice)
        ? current.filter(item => item !== choice)
        : [...current, choice]);
      return;
    }
    setSelectedChoices([choice]);
    setSubmittedAnswer(choice);
    onAnswer?.(choice);
  };

  const handleSubmitChoices = () => {
    if (!selectedChoices.length) return;
    const selected = [...selectedChoices];
    setSubmittedAnswer(selected.join(', '));
    onAnswer?.(selected);
  };

  const handleSubmitText = () => {
    if (textAnswer.trim() && onAnswer) {
      onAnswer(textAnswer.trim());
      setSubmittedAnswer(textAnswer.trim());
      setTextAnswer('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitText();
    }
  };

  return (
    <div className="hermes-clarify-card">
      <div className="hermes-clarify-header">
        <span className="hermes-clarify-badge">
          <HelpCircle size={13} className="hermes-clarify-icon" />
          <span>Clarify</span>
        </span>
      </div>
      <div className="hermes-clarify-body">
        <div className="hermes-clarify-question">{question}</div>

        {hasChoices && !hasAnswer && (
          <div className="hermes-clarify-choices">
            {choices!.map((choice, idx) => (
              <button
                key={idx}
                className={`hermes-clarify-choice${selectedChoices.includes(choice) ? ' submitted' : ''}`}
                onClick={() => handleChoiceClick(choice)}
                disabled={hasAnswer}
                aria-pressed={selectedChoices.includes(choice)}
              >
                <CornerDownRight size={12} className="hermes-clarify-choice-icon" />
                <span>{choice}</span>
                {selectedChoices.includes(choice) && (
                  <span className="hermes-clarify-choice-check">
                    <Check size={12} />
                  </span>
                )}
              </button>
            ))}
            {multiSelect && (
              <button
                type="button"
                className="hermes-clarify-submit"
                onClick={handleSubmitChoices}
                disabled={!selectedChoices.length || hasAnswer}
              >
                Confirm selection
                <Check size={14} />
              </button>
            )}
          </div>
        )}

        {!hasChoices && !hasAnswer && (
          <div className="hermes-clarify-input-row">
            <input
              type="text"
              className="hermes-clarify-input"
              placeholder="Type your answer..."
              value={textAnswer}
              onChange={e => setTextAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              className="hermes-clarify-send"
              onClick={handleSubmitText}
              disabled={!textAnswer.trim()}
              title="Send answer"
            >
              <Send size={14} />
            </button>
          </div>
        )}

        {hasAnswer && (
          <div className="hermes-clarify-answer">
            <ArrowRight size={13} className="hermes-clarify-arrow" />
            <span className="hermes-clarify-answer-text">{answer || submittedAnswer}</span>
          </div>
        )}
      </div>
    </div>
  );
};
