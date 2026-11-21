/**
 * Форматирование чисел по модели Metabase
 * (frontend/src/metabase/lib/formatting/number.tsx: number_style/decimals/scale/…),
 * переписано под ru-RU и RUB. Значения NULL = «нет данных».
 */

export interface FormatNumberOptions {
  /** decimal | percent | currency | compact (млн/тыс.) — как number_style в Metabase */
  numberStyle?: 'decimal' | 'percent' | 'currency' | 'compact';
  decimals?: number;
  /** множитель перед форматированием (scale в Metabase) */
  scale?: number;
  prefix?: string;
  suffix?: string;
  currency?: string; // ISO 4217, по умолчанию RUB
  /** убрать знак «+» для положительных (для абсолютных величин) */
  signed?: boolean;
}

const nf = (decimals: number) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const nfAuto = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Нет данных';

  const {
    numberStyle = 'decimal',
    decimals,
    scale = 1,
    prefix = '',
    suffix = '',
    currency = 'RUB',
    signed = true,
  } = options;

  const scaled = value * scale;
  const sign = signed && scaled > 0 ? '+' : scaled < 0 ? '−' : '';
  const abs = Math.abs(scaled);

  switch (numberStyle) {
    case 'percent': {
      const d = decimals ?? 2;
      return `${sign}${nf(d).format(abs)} %${suffix ? ` ${suffix}` : ''}`;
    }
    case 'currency': {
      const d = decimals ?? 2;
      const cur = currency === 'RUB' ? ' ₽' : ` ${currency}`;
      return `${prefix}${sign}${nf(d).format(abs)}${cur}${suffix}`;
    }
    case 'compact': {
      // компактные млн/тыс., как axis.autoRange у Metabase
      const mln = abs / 1e6;
      const text = mln >= 1 ? `${nf(decimals ?? 2).format(mln)} млн` : nfAuto.format(abs);
      return `${prefix}${sign}${text} ${currency === 'RUB' ? '₽' : currency}${suffix}`.trim();
    }
    default: {
      const d = decimals ?? 2;
      return `${prefix}${sign}${nf(d).format(abs)}${suffix}`;
    }
  }
}
