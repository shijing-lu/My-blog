import { useEffect, useRef } from 'react';
import { cancelMotion, feedback } from '@/lib/motion';

/** 只监听具体状态值；不会订阅编辑器内容或 AI 流式文本。 */
export function useMotionFeedback<T extends HTMLElement>(value: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    void feedback(element);
    return () => { if (element) cancelMotion(element); };
  }, [value]);
  return ref;
}
