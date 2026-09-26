import { CRITICAL_IMAGES, cssUrl, imageTask, fontsTask, trackTasks, WEIGHTS } from "./homeAssets";

// A fetch Response whose body streams the given chunk sizes.
function streamingResponse(chunks, { contentLength, status = 200 } = {}) {
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-length" && contentLength != null ? String(contentLength) : null) },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: new Uint8Array(chunks[i++]) } : { done: true })
      })
    }
  };
}

describe("critical asset list", () => {
  test("is the hero followed by the four experience card photographs", () => {
    expect(CRITICAL_IMAGES).toEqual([
      "/season2/media/home/hero-main.png",
      "/season2/media/home/experience-card-01.jpeg",
      "/season2/media/home/experience-card-02.jpeg",
      "/season2/media/home/experience-card-03.jpeg",
      "/season2/media/home/experience-card-04.jpeg"
    ]);
  });

  test("cssUrl reads plain and quoted url() values", () => {
    expect(cssUrl("url(/a.jpg)")).toBe("/a.jpg");
    expect(cssUrl('url("/b c.png")')).toBe("/b c.png");
    expect(cssUrl("linear-gradient(#000, #fff)")).toBeNull();
  });
});

describe("imageTask", () => {
  test("reports streamed bytes against Content-Length, and completes only after decode", async () => {
    const reports = [];
    let decoded = false;
    const task = imageTask("/x.png", {
      fetchImpl: async () => streamingResponse([400, 400, 200], { contentLength: 1000 }),
      decode: async () => {
        decoded = true;
      }
    });
    await task((loaded, total) => reports.push([loaded, total, decoded]));

    expect(reports[0]).toEqual([0, WEIGHTS.imageHint, false]); // before headers
    expect(reports).toContainEqual([380, 1000, false]); // 400 bytes (download = 95%)
    expect(reports).toContainEqual([760, 1000, false]);
    const beforeDecode = reports.filter(([, , d]) => !d);
    expect(Math.max(...beforeDecode.map(([l]) => l))).toBe(950); // never "done" before decode
    expect(reports[reports.length - 1]).toEqual([1000, 1000, true]);
  });

  test("a failed request still settles (after a plain image load attempt)", async () => {
    const decode = jest.fn(async () => {});
    const reports = [];
    await imageTask("/missing.png", {
      fetchImpl: async () => streamingResponse([], { status: 404 }),
      decode
    })((l, t) => reports.push([l, t]));
    expect(decode).toHaveBeenCalledWith("/missing.png");
    const [l, t] = reports[reports.length - 1];
    expect(l).toBe(t);
  });
});

describe("fontsTask", () => {
  test("waits for Archivo and document.fonts.ready", async () => {
    let resolveReady;
    const fonts = {
      load: jest.fn(async () => []),
      ready: new Promise((r) => {
        resolveReady = r;
      })
    };
    const reports = [];
    const done = fontsTask(fonts)((l, t) => reports.push([l, t]));
    await Promise.resolve();
    expect(fonts.load).toHaveBeenCalledWith('800 1em "Archivo"', expect.any(String));
    expect(reports).toEqual([[0, WEIGHTS.fonts]]);
    resolveReady();
    await done;
    expect(reports[reports.length - 1]).toEqual([WEIGHTS.fonts, WEIGHTS.fonts]);
  });
});

describe("trackTasks", () => {
  test("progress is byte-weighted, monotonic, and reaches 1 only when every task settles", async () => {
    const controls = [];
    const task = (total) => (report) =>
      new Promise((resolve) => {
        report(0, total);
        controls.push({ report: (l) => report(l, total), resolve });
      });
    const seen = [];
    const run = trackTasks([task(900), task(100)], { onProgress: (f) => seen.push(f), maxWait: 10000 });

    controls[0].report(450); // half of the big task = 45% overall
    expect(seen[seen.length - 1]).toBeCloseTo(0.45);
    controls[1].report(100); // small task fully downloaded but NOT settled
    expect(seen[seen.length - 1]).toBeCloseTo(0.55);
    controls[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    controls[0].report(900);
    expect(seen[seen.length - 1]).toBeLessThan(1); // capped until settled
    controls[0].resolve();

    await expect(run).resolves.toEqual({ timedOut: false });
    expect(seen[seen.length - 1]).toBe(1);
    seen.reduce((prev, f) => {
      expect(f).toBeGreaterThanOrEqual(prev);
      return f;
    }, 0);
  });

  test("a task that throws counts as settled", async () => {
    const run = trackTasks([
      () => {
        throw new Error("boom");
      },
      async (report) => report(1, 1)
    ]);
    await expect(run).resolves.toEqual({ timedOut: false });
  });

  test("the safety timeout releases a stalled load", async () => {
    jest.useFakeTimers();
    try {
      const run = trackTasks([() => new Promise(() => {})], { maxWait: 15000 });
      jest.advanceTimersByTime(15000);
      await expect(run).resolves.toEqual({ timedOut: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
