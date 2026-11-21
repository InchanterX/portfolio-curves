import { useEffect, useState } from 'react';

/**
 * Тонкий клиент REST API бэкенда (backend/, см. BACKEND.md).
 * Если бэкенд недоступен (нет сервера, БД не поднята), все запросы
 * прозрачно возвращают fallback — фронтенд продолжает работать на моках.
 */

export const API_BASE = '/api';

export async function apiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Подписаться на данные эндпоинта. Пока ответ не получен (или бэкенд недоступен),
 * отдаётся fallback. `live` = true, когда данные реально пришли с сервера.
 */
export function useApi<T>(path: string, fallback: T): { data: T; live: boolean } {
  const [state, setState] = useState<{ data: T; live: boolean }>({ data: fallback, live: false });

  useEffect(() => {
    let cancelled = false;
    apiGet<T>(path, fallback).then((data) => {
      if (cancelled) return;
      setState({ data, live: data !== fallback });
    });
    return () => {
      cancelled = true;
    };
    // fallback сравнивается по ссылке; моки — константы, поэтому зависимости стабильны
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return state;
}
