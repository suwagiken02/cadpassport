'use client';
import React, { useState, useEffect } from 'react';

type Props = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
};

/** 数値入力コンポーネント。文字列stateで中間状態を保持し、blur時に確定する */
export default function NumInput({ value, onChange, min = 0, step, className, onFocus, onBlur }: Props) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(text);
    if (!isNaN(n) && n >= min) {
      onChange(n);
    } else {
      setText(String(value));
    }
    onBlur?.();
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
      step={step}
      className={className || 'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm'}
    />
  );
}
