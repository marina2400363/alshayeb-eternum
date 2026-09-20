import { normalizePhone, isEgyptianPhone, sanitizePhoneInput, maskPhone, formatPhoneDisplay } from "./phone";
import {
  validatePhone,
  validateFullName,
  validateSchool,
  validateEmail,
  FULL_NAME_MAX,
  PHONE_REQUIRED,
  PHONE_INVALID,
  EMAIL_REQUIRED,
  EMAIL_INVALID
} from "./validation";
import { normalizeEmail, isValidEmail } from "./email";
import {
  validatePhotoFile,
  processPhoto,
  PHOTO_ERRORS,
  MAX_UPLOAD_PHOTO_BYTES,
  MAX_RAW_PHOTO_BYTES
} from "./photo";

function fakeFile(name, type, size = 1000) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("phone", () => {
  test.each([
    ["01012345678", "01012345678"],
    ["+201012345678", "01012345678"],
    ["201012345678", "01012345678"],
    ["1012345678", "01012345678"],
    ["010 1234 5678", "01012345678"],
    ["(010) 1234-5678", "01012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "01012345678"],
    ["۰۱۰۱۲۳۴۵۶۷۸", "01012345678"],
    ["", ""],
    [null, ""]
  ])("normalizePhone(%p) → %p", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test("isEgyptianPhone mirrors the backend rule (01 + 9 digits)", () => {
    expect(isEgyptianPhone("01512345678")).toBe(true);
    expect(isEgyptianPhone("+201112345678")).toBe(true);
    expect(isEgyptianPhone("0212345678")).toBe(false);
    expect(isEgyptianPhone("0101234567")).toBe(false);
    expect(isEgyptianPhone("010123456789")).toBe(false);
    expect(isEgyptianPhone("abc")).toBe(false);
  });

  test("sanitizePhoneInput strips junk but keeps phone punctuation", () => {
    expect(sanitizePhoneInput("+20 101-234 5678abc")).toBe("+20 101-234 5678");
    expect(sanitizePhoneInput("٠١٠")).toBe("010");
  });

  test("maskPhone / formatPhoneDisplay only format complete numbers", () => {
    expect(maskPhone("+201012345678")).toBe("010 •••• 5678");
    expect(maskPhone("0101")).toBe("");
    expect(formatPhoneDisplay("01012345678")).toBe("010 1234 5678");
    expect(formatPhoneDisplay("0101")).toBe("0101");
  });
});

describe("validation", () => {
  test("validatePhone", () => {
    expect(validatePhone("")).toBe(PHONE_REQUIRED);
    expect(validatePhone("   ")).toBe(PHONE_REQUIRED);
    expect(validatePhone("12345")).toBe(PHONE_INVALID);
    expect(validatePhone("01012345678")).toBe("");
    expect(validatePhone("+20 101 234 5678")).toBe("");
  });

  test("validateFullName", () => {
    expect(validateFullName("")).not.toBe("");
    expect(validateFullName("  a ")).not.toBe("");
    expect(validateFullName("Marina Adel")).toBe("");
    expect(validateFullName("x".repeat(81))).not.toBe("");
    // boundary: exactly the limit is fine, one more is not
    expect(FULL_NAME_MAX).toBe(80);
    expect(validateFullName("x".repeat(FULL_NAME_MAX))).toBe("");
    expect(validateFullName("x".repeat(FULL_NAME_MAX + 1))).not.toBe("");
    // the limit counts the cleaned name (extra spaces collapse first)
    expect(validateFullName("a  ".repeat(20).trim())).toBe("");
  });

  test("validateEmail: required, then practical format", () => {
    expect(validateEmail("")).toBe(EMAIL_REQUIRED);
    expect(validateEmail("   ")).toBe(EMAIL_REQUIRED);
    expect(validateEmail(undefined)).toBe(EMAIL_REQUIRED);
    for (const bad of ["name", "name@", "@example.com", "name@example", "name@.com", "name@example..com", "a b@c.com", "a@@b.com", "name@example."]) {
      expect(validateEmail(bad)).toBe(EMAIL_INVALID);
    }
    for (const good of ["name@example.com", "person.name@gmail.com", "UPPER@CASE.COM", "  spaced@example.com  ", "a+tag@sub.domain.co.uk"]) {
      expect(validateEmail(good)).toBe("");
    }
    expect(validateEmail("x".repeat(250) + "@a.co")).toBe(EMAIL_INVALID); // > 254 chars
  });

  test("validateSchool requires an id that exists in the fetched list", () => {
    const schools = [{ id: "a", name: "A" }];
    expect(validateSchool("", schools)).not.toBe("");
    expect(validateSchool("zzz", schools)).not.toBe("");
    expect(validateSchool("a", schools)).toBe("");
  });
});

describe("full name limit", () => {
  // The backend enforces the same limit; the two must never drift apart.
  test("the frontend limit equals the backend's FULL_NAME_MAX_LENGTH", () => {
    // eslint-disable-next-line global-require
    const fs = require("fs");
    // eslint-disable-next-line global-require
    const path = require("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../../backend/src/routes/attendeeRoutes.js"), "utf8");
    const match = source.match(/FULL_NAME_MAX_LENGTH\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(FULL_NAME_MAX);
  });
});

describe("email normalization", () => {
  test("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Person.Name@Gmail.COM \t")).toBe("person.name@gmail.com");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });

  // The backend is the authority — the two implementations must never disagree.
  test("the frontend rule matches the backend rule exactly", () => {
    // eslint-disable-next-line global-require, import/no-unresolved
    const backend = require("../../../../../backend/src/utils/emailAddress");
    const samples = [
      "", " ", "name", "name@", "@example.com", "name@example", "name@.com", "name@example..com", "a b@c.com", "a@@b.com",
      "name@example.", "name@example.com", "person.name@gmail.com", "UPPER@CASE.COM", "  spaced@example.com  ",
      "a+tag@sub.domain.co.uk", "x".repeat(250) + "@a.co", "x".repeat(240) + "@a.co", "üser@example.com"
    ];
    for (const sample of samples) {
      expect([sample, isValidEmail(sample)]).toEqual([sample, backend.isValidEmail(sample)]);
      expect(normalizeEmail(sample)).toBe(backend.cleanEmail(sample));
    }
  });
});

describe("photo", () => {
  test("accepts JPEG / JPG / PNG only", () => {
    expect(validatePhotoFile(fakeFile("a.jpg", "image/jpeg"))).toBe("");
    expect(validatePhotoFile(fakeFile("a.jpeg", "image/jpg"))).toBe("");
    expect(validatePhotoFile(fakeFile("a.png", "image/png"))).toBe("");
    expect(validatePhotoFile(fakeFile("a.heic", "image/heic"))).toBe(PHOTO_ERRORS.unsupported);
    expect(validatePhotoFile(fakeFile("a.webp", "image/webp"))).toBe(PHOTO_ERRORS.unsupported);
    expect(validatePhotoFile(fakeFile("a.gif", "image/gif"))).toBe(PHOTO_ERRORS.unsupported);
  });

  test("falls back to extension only when the picker reports no MIME type", () => {
    expect(validatePhotoFile(fakeFile("a.jpg", ""))).toBe("");
    expect(validatePhotoFile(fakeFile("a.heic", ""))).toBe(PHOTO_ERRORS.unsupported);
  });

  test("rejects a missing file and an oversized raw file", () => {
    expect(validatePhotoFile(null)).not.toBe("");
    expect(validatePhotoFile(fakeFile("a.jpg", "image/jpeg", MAX_RAW_PHOTO_BYTES + 1))).toBe(PHOTO_ERRORS.tooLarge);
  });

  test("processPhoto returns a .jpg File under the upload ceiling", async () => {
    const compress = async () => new Blob(["y".repeat(100)], { type: "image/jpeg" });
    const result = await processPhoto(fakeFile("me.PNG", "image/png"), { compress });
    expect(result.error).toBeUndefined();
    expect(result.file.name).toBe("me.jpg");
    expect(result.file.type).toBe("image/jpeg");
  });

  test("processPhoto retries smaller settings until the result fits", async () => {
    const calls = [];
    const compress = async (file, options) => {
      calls.push(options.maxDimension);
      const bytes = calls.length < 3 ? MAX_UPLOAD_PHOTO_BYTES + 10 : 10;
      const blob = new Blob(["z"], { type: "image/jpeg" });
      Object.defineProperty(blob, "size", { value: bytes });
      return blob;
    };
    const result = await processPhoto(fakeFile("me.jpg", "image/jpeg"), { compress });
    expect(calls).toEqual([1280, 1024, 800]);
    expect(result.file).toBeDefined();
  });

  test("processPhoto reports unreadable and still-too-large images instead of throwing", async () => {
    const boom = async () => {
      throw new Error("decode");
    };
    expect(await processPhoto(fakeFile("me.jpg", "image/jpeg"), { compress: boom })).toEqual({
      error: PHOTO_ERRORS.unreadable
    });

    const huge = async () => {
      const blob = new Blob(["z"], { type: "image/jpeg" });
      Object.defineProperty(blob, "size", { value: MAX_UPLOAD_PHOTO_BYTES + 1 });
      return blob;
    };
    expect(await processPhoto(fakeFile("me.jpg", "image/jpeg"), { compress: huge })).toEqual({
      error: PHOTO_ERRORS.stillTooLarge
    });
  });

  test("processPhoto rejects an unsupported format without compressing", async () => {
    const compress = jest.fn();
    const result = await processPhoto(fakeFile("a.heic", "image/heic"), { compress });
    expect(result.error).toBe(PHOTO_ERRORS.unsupported);
    expect(compress).not.toHaveBeenCalled();
  });
});
