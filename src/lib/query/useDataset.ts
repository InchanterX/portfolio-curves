import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import type { Dataset, QueryStatus, Question } from './types';

/**
 * useDataset по модели Metabase: страница описывает «вопрос» (question) —
 * эндпоинт + fallback — и получает dataset со статусом выполнения.
 *
 *   const { dataset, status } = useDataset(QUESTIONS.curvePoints);
 */
export function useDataset(question: Question): { dataset: Dataset; status: QueryStatus } {
  const [state, setState] = useState<{ dataset: Dataset; status: QueryStatus }>({
    dataset: question.fallback,
    status: 'idle',
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    apiGet<Dataset>(question.endpoint, question.fallback).then((dataset) => {
      if (cancelled) return;
      setState({ dataset, status: 'success' });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.endpoint]);

  return state;
}
