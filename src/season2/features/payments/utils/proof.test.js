import {
  validateProofFile,
  processProof,
  PROOF_ERRORS,
  MAX_UPLOAD_PROOF_BYTES,
  MAX_RAW_PROOF_BYTES
} from "./proof";

function fakeFile(name, type, size = 1000) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateProofFile", () => {
  test("accepts JPEG / JPG / PNG only", () => {
    expect(validateProofFile(fakeFile("a.jpg", "image/jpeg"))).toBe("");
    expect(validateProofFile(fakeFile("a.jpeg", "image/jpg"))).toBe("");
    expect(validateProofFile(fakeFile("a.png", "image/png"))).toBe("");
    expect(validateProofFile(fakeFile("a.pdf", "application/pdf"))).toBe(PROOF_ERRORS.unsupported);
    expect(validateProofFile(fakeFile("a.webp", "image/webp"))).toBe(PROOF_ERRORS.unsupported);
    expect(validateProofFile(fakeFile("a.heic", "image/heic"))).toBe(PROOF_ERRORS.unsupported);
  });

  test("falls back to extension only when the picker reports no MIME type", () => {
    expect(validateProofFile(fakeFile("a.png", ""))).toBe("");
    expect(validateProofFile(fakeFile("a.pdf", ""))).toBe(PROOF_ERRORS.unsupported);
  });

  test("rejects a missing file and an oversized raw file", () => {
    expect(validateProofFile(null)).not.toBe("");
    expect(validateProofFile(fakeFile("a.jpg", "image/jpeg", MAX_RAW_PROOF_BYTES + 1))).toBe(PROOF_ERRORS.tooLarge);
  });
});

describe("processProof", () => {
  test("returns a .jpg File under the upload ceiling", async () => {
    const compress = async () => new Blob(["y".repeat(100)], { type: "image/jpeg" });
    const result = await processProof(fakeFile("screenshot.PNG", "image/png"), { compress });
    expect(result.error).toBeUndefined();
    expect(result.file.name).toBe("screenshot.jpg");
    expect(result.file.type).toBe("image/jpeg");
  });

  test("retries smaller settings until the result fits, largest first", async () => {
    const calls = [];
    const compress = async (file, options) => {
      calls.push(options.maxDimension);
      const bytes = calls.length < 3 ? MAX_UPLOAD_PROOF_BYTES + 10 : 10;
      const blob = new Blob(["z"], { type: "image/jpeg" });
      Object.defineProperty(blob, "size", { value: bytes });
      return blob;
    };
    const result = await processProof(fakeFile("proof.jpg", "image/jpeg"), { compress });
    expect(calls).toEqual([1600, 1280, 1000]);
    expect(result.file).toBeDefined();
  });

  test("reports unreadable and still-too-large images instead of throwing", async () => {
    const boom = async () => {
      throw new Error("decode");
    };
    expect(await processProof(fakeFile("proof.jpg", "image/jpeg"), { compress: boom })).toEqual({
      error: PROOF_ERRORS.unreadable
    });

    const huge = async () => {
      const blob = new Blob(["z"], { type: "image/jpeg" });
      Object.defineProperty(blob, "size", { value: MAX_UPLOAD_PROOF_BYTES + 1 });
      return blob;
    };
    expect(await processProof(fakeFile("proof.jpg", "image/jpeg"), { compress: huge })).toEqual({
      error: PROOF_ERRORS.stillTooLarge
    });
  });

  test("rejects an unsupported format without compressing", async () => {
    const compress = jest.fn();
    const result = await processProof(fakeFile("a.pdf", "application/pdf"), { compress });
    expect(result.error).toBe(PROOF_ERRORS.unsupported);
    expect(compress).not.toHaveBeenCalled();
  });

  test("rejects a missing file without compressing", async () => {
    const compress = jest.fn();
    const result = await processProof(null, { compress });
    expect(result.error).toBeTruthy();
    expect(compress).not.toHaveBeenCalled();
  });
});
