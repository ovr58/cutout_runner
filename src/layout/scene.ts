import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { type Browser, type BrowserContext, chromium } from 'playwright';

import { errorMessage, log } from '../logger';
import { type Canvas, type LayoutRequest, parseLayoutRequest } from './request';

/**
 * Снятие сцены HTML (`HtmlScene` родительского продукта) в Chromium.
 *
 * Граница доверия: HTML пишет модель, поэтому страница открывается в контексте **без JS**
 * (`javaScriptEnabled: false`) и **без сети** — каждый запрос страницы перехватывается, и
 * ответ получают только сам документ, `frame.png` из тела запроса и свои шрифты; всё прочее
 * обрывается. Наружу уходит только JSON сцены, никаких снимков экрана.
 *
 * Код внутри страницы — копия `assets/layout/extract-browser.js`, снятая с родительского
 * продукта: офлайн-инструмент и сервис исполняют один и тот же текст обхода DOM.
 */

export type LayoutOutcome =
  | { readonly kind: 'scene'; readonly scene: unknown }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'refused'; readonly reason: 'script' | 'url' | 'timeout' };

export interface LayoutRunner {
  readonly run: (body: Buffer) => Promise<LayoutOutcome>;
  readonly close: () => Promise<void>;
}

interface BrowserCode {
  readonly FONT_FACES: readonly (readonly [file: string, family: string, weight: number])[];
  readonly dropForeignFontFaces: () => void;
  readonly addStyle: (css: string) => void;
  readonly missingFonts: (faces: unknown) => Promise<string[]>;
  readonly sceneInPage: (canvas: Canvas) => unknown;
}

/** Выдуманный адрес: страница должна иметь origin, чтобы `frame.png` разрешился относительно. */
const ORIGIN = 'http://layout.invalid';
const PAGE_URL = `${ORIGIN}/card.html`;

export function createLayoutRunner(options: {
  readonly assetsDir: string;
  /** Потолок на одну страницу — от открытия контекста до готовой сцены. */
  readonly timeoutMs: number;
}): LayoutRunner {
  const code = loadBrowserCode(join(options.assetsDir, 'layout', 'extract-browser.js'));
  const fonts = new Map(
    code.FONT_FACES.map(([file]) => [file, readFileSync(join(options.assetsDir, 'fonts', file))]),
  );
  const fontCss = code.FONT_FACES.map(
    ([file, family, weight]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};src:url('${ORIGIN}/fonts/${file}') format('truetype')}`,
  ).join('\n');

  // Один браузер на процесс: запуск Chromium стоит секунды, страница — десятки миллисекунд.
  let browser: Promise<Browser> | null = null;
  const getBrowser = (): Promise<Browser> => {
    if (browser === null) {
      const launching = chromium.launch();
      browser = launching;
      launching.then(
        (ready) =>
          ready.on('disconnected', () => {
            // Своё закрытие (close) сбрасывает ссылку раньше — в журнал идёт только падение.
            if (browser !== launching) return;
            log.error('layout.browser_disconnected');
            browser = null;
          }),
        () => {
          if (browser === launching) browser = null;
        },
      );
    }
    return browser;
  };

  const snapshot = async (context: BrowserContext, request: LayoutRequest): Promise<unknown> => {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url === PAGE_URL) {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: request.html });
      }
      if (url === `${ORIGIN}/frame.png`) {
        return route.fulfill({ contentType: request.frameType, body: request.frame });
      }
      const font = url.startsWith(`${ORIGIN}/fonts/`) ? fonts.get(url.slice(ORIGIN.length + 7)) : undefined;
      if (font !== undefined) return route.fulfill({ contentType: 'font/ttf', body: font });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(PAGE_URL);
    await page.evaluate(code.dropForeignFontFaces);
    // Не page.addStyleTag: тот ждёт события load элемента, а без JS страницы оно не наступает.
    await page.evaluate(code.addStyle, fontCss);
    const missing = await page.evaluate(code.missingFonts, code.FONT_FACES);
    // Шрифты свои и лежат рядом: незагрузившийся — поломка установки, а не плохой HTML.
    if (missing.length > 0) throw new Error(`fonts not loaded: ${missing.join(', ')}`);
    return page.evaluate(code.sceneInPage, request.canvas);
  };

  return {
    async run(body) {
      const parsed = parseLayoutRequest(body);
      if (parsed.kind !== 'request') return parsed;
      const { request } = parsed;

      const context = await (await getBrowser()).newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
        viewport: request.canvas,
        deviceScaleFactor: 1,
      });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), options.timeoutMs);
      });
      try {
        const job = snapshot(context, request);
        // По истечении времени работа обрывается закрытием контекста и падает уже без слушателя.
        job.catch(() => undefined);
        const result = await Promise.race([job, timeout]);
        if (result === 'timeout') return { kind: 'refused', reason: 'timeout' };
        return { kind: 'scene', scene: result };
      } finally {
        clearTimeout(timer);
        // Закрытие контекста обрывает и зависшую страницу: следующий запрос её не унаследует.
        await context.close().catch((err: unknown) => {
          log.error('layout.context_close_failed', { reason: errorMessage(err) });
        });
      }
    },
    async close() {
      const current = browser;
      browser = null;
      if (current !== null) await (await current.catch(() => null))?.close();
    },
  };
}

/** Копия кода страницы — выражение-объект; проверяется при старте, а не на первом запросе. */
function loadBrowserCode(path: string): BrowserCode {
  const value: unknown = vm.runInNewContext(readFileSync(path, 'utf8'), {}, { filename: path });
  const code = value as Partial<BrowserCode> | null;
  if (
    code === null ||
    typeof code !== 'object' ||
    !Array.isArray(code.FONT_FACES) ||
    typeof code.dropForeignFontFaces !== 'function' ||
    typeof code.addStyle !== 'function' ||
    typeof code.missingFonts !== 'function' ||
    typeof code.sceneInPage !== 'function'
  ) {
    throw new Error(`browser code is malformed: ${path}`);
  }
  return code as BrowserCode;
}
