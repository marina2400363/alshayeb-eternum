import { fetchSchools, lookupIncomer, registerIncomer, toCustomer, ApiError, NETWORK_ERROR_MESSAGE } from "./onboarding.api";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// What the Season 2 endpoints return: the minimal shape and nothing else.
const SEASON2_ATTENDEE = { id: "abc123", fullName: "Marina Adel", phone: "01012345678", attendeeType: "incomer" };

// A FULL legacy-shaped record — what the legacy lookup returns. Season 2 must
// never let any of it through, even if a response ever carried it.
const ATTENDEE = {
  id: "abc123",
  fullName: "Marina Adel",
  phone: "01012345678",
  attendeeType: "incomer",
  schoolId: "school1",
  ticketPrice: 1500,
  status: "pending",
  paymentStatus: "pending",
  qrId: "ALSHAYEB-0001",
  qrToken: "secret-token",
  email: "marina@example.com",
  incomerPhoto: { url: "https://cdn/x.jpg" }
};

beforeEach(() => {
  global.fetch = jest.fn();
});

describe("toCustomer", () => {
  test("the customer is exactly { id, fullName, phone, attendeeType }", () => {
    expect(toCustomer(SEASON2_ATTENDEE)).toEqual(SEASON2_ATTENDEE);
  });

  test("a full legacy-shaped record is reduced to the same four fields (defence in depth)", () => {
    const customer = toCustomer(ATTENDEE);
    expect(customer).toEqual(SEASON2_ATTENDEE);
    for (const key of ["schoolId", "ticketPrice", "status", "paymentStatus", "createdAt", "email", "qrToken", "qrId", "incomerPhoto"]) {
      expect(customer).not.toHaveProperty(key);
    }
    expect(JSON.stringify(customer)).not.toMatch(/qr|photo|cdn|secret-token|1500/i);
  });

  test("the customer profile never carries the email (it is data, not identity)", () => {
    expect(toCustomer(ATTENDEE)).not.toHaveProperty("email");
    expect(JSON.stringify(toCustomer(ATTENDEE))).not.toMatch(/marina@example/);
  });
});

describe("fetchSchools", () => {
  test("maps _id → id and drops ticketPrice", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, schools: [{ _id: "s1", name: "Alpha", ticketPrice: 900 }, { _id: "", name: "bad" }] })
    );
    const schools = await fetchSchools();
    expect(schools).toEqual([{ id: "s1", name: "Alpha" }]);
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/schools$/);
  });

  test("returns [] when the list is empty", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, schools: [] }));
    expect(await fetchSchools()).toEqual([]);
  });
});

describe("lookupIncomer", () => {
  test("uses the dedicated Season 2 endpoint with the normalized phone ONLY", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, found: true, attendee: SEASON2_ATTENDEE }));
    const result = await lookupIncomer("+20 101 234 5678");
    const url = fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/attendees\/season2\/lookup\?phone=01012345678$/);
    // no attendee type is sent, and the legacy endpoint is never used
    expect(url).not.toContain("type=");
    expect(url).not.toMatch(/\/api\/attendees\/lookup/);
    expect(result).toEqual({ found: true, customer: SEASON2_ATTENDEE });
  });

  test("even a legacy-shaped response cannot leak QR fields into the customer", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, found: true, attendee: ATTENDEE }));
    const result = await lookupIncomer("01012345678");
    expect(result.customer).toEqual(SEASON2_ATTENDEE);
    expect(result.customer).not.toHaveProperty("qrToken");
  });

  test("found:false → not found", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, found: false, attendee: null }));
    expect(await lookupIncomer("01012345678")).toEqual({ found: false, customer: null });
  });

  test("a non-incomer record is treated as not found", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, found: true, attendee: { ...ATTENDEE, attendeeType: "outcomer" } })
    );
    expect((await lookupIncomer("01012345678")).found).toBe(false);
  });

  test("surfaces 4xx server messages", async () => {
    fetch.mockResolvedValue(jsonResponse(422, { success: false, message: "Enter an Egyptian phone number." }));
    await expect(lookupIncomer("01012345678")).rejects.toMatchObject({
      message: "Enter an Egyptian phone number.",
      status: 422,
      kind: "http"
    });
  });

  test("hides raw 5xx messages behind generic copy and marks them retryable", async () => {
    fetch.mockResolvedValue(jsonResponse(500, { success: false, message: "stack trace here" }));
    const error = await lookupIncomer("01012345678").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).not.toMatch(/stack/);
    expect(error.isRetryable).toBe(true);
  });

  test("a network failure becomes a retryable network ApiError", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await lookupIncomer("01012345678").catch((e) => e);
    expect(error.kind).toBe("network");
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.isRetryable).toBe(true);
  });

  test("an aborted request is reported as aborted, not as a network error", async () => {
    const controller = new AbortController();
    fetch.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const error = await lookupIncomer("01012345678", { signal: controller.signal }).catch((e) => e);
    expect(error.kind).toBe("aborted");
  });
});

describe("registerIncomer", () => {
  test("posts multipart with the exact backend field names", async () => {
    fetch.mockResolvedValue(jsonResponse(201, { success: true, attendee: ATTENDEE }));
    const photo = new File(["x"], "me.jpg", { type: "image/jpeg" });
    const result = await registerIncomer({
      fullName: "Marina Adel",
      phone: "+201012345678",
      email: "  Marina.Adel@Example.COM ",
      schoolId: "school1",
      photo
    });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/attendees\/register$/);
    expect(options.method).toBe("POST");
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("attendeeType")).toBe("incomer");
    expect(options.body.get("fullName")).toBe("Marina Adel");
    expect(options.body.get("phoneNumber")).toBe("01012345678");
    // email is normalized (trim + lowercase) before it leaves the browser
    expect(options.body.get("email")).toBe("marina.adel@example.com");
    expect(options.body.get("schoolId")).toBe("school1");
    expect(options.body.get("incomerPhoto")).toBeInstanceOf(File);
    expect(options.body.has("ticketPrice")).toBe(false);
    // exactly these six parts — nothing else is sent
    expect(Array.from(options.body.keys())).toEqual(["attendeeType", "fullName", "phoneNumber", "email", "schoolId", "incomerPhoto"]);
    expect(result.duplicate).toBe(false);
    expect(result.customer.id).toBe("abc123");
  });

  test("accepts the minimal Season 2 shape for BOTH 201 and duplicate 200", async () => {
    const photo = new File(["x"], "me.jpg", { type: "image/jpeg" });
    fetch.mockResolvedValueOnce(jsonResponse(201, { success: true, message: "Incomer registered.", attendee: SEASON2_ATTENDEE }));
    const created = await registerIncomer({ fullName: "Marina Adel", phone: "01012345678", email: "m@x.co", schoolId: "s1", photo });
    expect(created).toEqual({ duplicate: false, customer: SEASON2_ATTENDEE });

    fetch.mockResolvedValueOnce(jsonResponse(200, { success: true, duplicate: true, message: "Existing registration found.", attendee: SEASON2_ATTENDEE }));
    const duplicate = await registerIncomer({ fullName: "Marina Adel", phone: "01012345678", email: "m@x.co", schoolId: "s1", photo });
    expect(duplicate).toEqual({ duplicate: true, customer: SEASON2_ATTENDEE });
  });

  test("HTTP 200 with duplicate:true is reported as a duplicate", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, duplicate: true, attendee: { ...ATTENDEE, incomerPhoto: undefined } }));
    const photo = new File(["x"], "me.jpg", { type: "image/jpeg" });
    const result = await registerIncomer({ fullName: "x y", phone: "01012345678", email: "other@example.com", schoolId: "s", photo });
    expect(result.duplicate).toBe(true);
    expect(result.customer).not.toHaveProperty("photoUrl");
  });
});
