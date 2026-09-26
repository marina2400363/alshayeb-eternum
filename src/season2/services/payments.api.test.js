import {
  fetchCustomerPaymentSummary,
  fetchCustomerPaymentOptions,
  acknowledgePaymentConfirmation,
  createDeposit,
  fetchInstaPayLink,
  ApiError,
  NETWORK_ERROR_MESSAGE
} from "./payments.api";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const RAW_SUMMARY = {
  ticketPriceVisible: true,
  ticketPrice: 6000,
  paymentStatus: "ready",
  paymentConfirmation: { depositId: "d1" },
  latestRejection: null
};

// A response shaped like it carries forbidden fields — the mapper must strip
// everything down to the documented shape regardless: payment progress, the
// (removed) deposit history, and a previous payment's amount.
const OVERSHARING_SUMMARY = {
  ...RAW_SUMMARY,
  attendeeId: "atd1",
  phone: "01012345678",
  schoolId: "school-b",
  approvedTotal: 2000,
  remaining: 4000,
  progress: 0.33,
  activeDepositCount: 2,
  deposits: [{ id: "d0", amount: 1000, status: "approved", proof: { url: "https://cdn/x.jpg", publicId: "abc" } }],
  paymentConfirmation: {
    ...RAW_SUMMARY.paymentConfirmation,
    amount: 7000,
    label: "Big one",
    approvedAt: "2026-01-03T00:00:00.000Z",
    paymentOptionId: "po1",
    activeSlot: 1,
    proof: { url: "https://cdn/x.jpg", publicId: "abc" },
    reviewedBy: "admin1",
    customerConfirmationPending: true
  },
  latestRejection: { reason: "Blurry.", reviewedBy: "admin1", depositId: "d9" }
};

beforeEach(() => {
  global.fetch = jest.fn();
});

describe("fetchCustomerPaymentSummary", () => {
  test("posts { attendeeId, phone } as JSON to the dedicated endpoint", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: RAW_SUMMARY }));
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "atd1", phone: "01012345678" });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/payments\/customer-summary$/);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ attendeeId: "atd1", phone: "01012345678" });

    expect(summary).toEqual(RAW_SUMMARY);
  });

  test("never sends phone in the URL/query string", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: RAW_SUMMARY }));
    await fetchCustomerPaymentSummary({ attendeeId: "atd1", phone: "01012345678" });
    const url = fetch.mock.calls[0][0];
    expect(url).not.toContain("01012345678");
    expect(url).not.toContain("phone=");
  });

  test("strips history, totals, progress, ids, a previous amount and deposit internals", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: OVERSHARING_SUMMARY }));
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "atd1", phone: "01012345678" });

    expect(summary).toEqual({ ...RAW_SUMMARY, latestRejection: { reason: "Blurry." } });
    expect(JSON.stringify(summary)).not.toMatch(
      /approvedTotal|remaining|progress|activeDepositCount|7000|Big one|schoolId|label|paymentOptionId|activeSlot|publicId|reviewedBy|customerConfirmation|cdn|d0|d9/
    );
  });

  test("a hidden ticket price is never carried — even if an amount slipped into the response", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, summary: { ...RAW_SUMMARY, ticketPriceVisible: false, ticketPrice: 4500 } })
    );
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" });
    expect(summary.ticketPriceVisible).toBe(false);
    expect(summary.ticketPrice).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("4500");
  });

  test("visibility must be explicitly true — a missing flag hides the price", async () => {
    const { ticketPriceVisible, ...withoutFlag } = RAW_SUMMARY;
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: withoutFlag }));
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" });
    expect(summary.ticketPriceVisible).toBe(false);
    expect(summary.ticketPrice).toBeNull();
  });

  test("a confirmation without a depositId is dropped (never an un-acknowledgeable popup)", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, summary: { ...RAW_SUMMARY, paymentConfirmation: { approvedAt: "2026-01-03" } } })
    );
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" });
    expect(summary.paymentConfirmation).toBeNull();
  });

  test("an unknown status is never treated as payable", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: { ...RAW_SUMMARY, paymentStatus: "weird" } }));
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" });
    expect(summary.paymentStatus).not.toBe("ready");
  });

  test("the summary is exactly the five current-state fields — nothing else", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, summary: RAW_SUMMARY }));
    const summary = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" });
    expect(Object.keys(summary).sort()).toEqual([
      "latestRejection",
      "paymentConfirmation",
      "paymentStatus",
      "ticketPrice",
      "ticketPriceVisible"
    ]);
  });

  test("surfaces the generic ownership-mismatch 404 message from the backend", async () => {
    fetch.mockResolvedValue(jsonResponse(404, { success: false, message: "We couldn't verify this account. Check your details and try again." }));
    await expect(fetchCustomerPaymentSummary({ attendeeId: "a", phone: "wrong" })).rejects.toMatchObject({
      status: 404,
      message: "We couldn't verify this account. Check your details and try again."
    });
  });

  test("a network failure becomes a retryable network ApiError", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.isRetryable).toBe(true);
  });

  test("hides raw 5xx messages and marks them retryable", async () => {
    fetch.mockResolvedValue(jsonResponse(500, { success: false, message: "stack trace" }));
    const error = await fetchCustomerPaymentSummary({ attendeeId: "a", phone: "p" }).catch((e) => e);
    expect(error.message).not.toMatch(/stack/);
    expect(error.isRetryable).toBe(true);
  });
});

describe("acknowledgePaymentConfirmation", () => {
  test("POSTs exactly { attendeeId, phone, depositId } as JSON — phone never in the URL", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    await acknowledgePaymentConfirmation({ attendeeId: "atd1", phone: "01012345678", depositId: "dep1" });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/payments\/acknowledge-confirmation$/);
    expect(url).not.toContain("01012345678");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ attendeeId: "atd1", phone: "01012345678", depositId: "dep1" });
  });

  test("rejects (so the popup stays open) when the backend refuses", async () => {
    fetch.mockResolvedValue(jsonResponse(404, { success: false, message: "Payment confirmation not found." }));
    await expect(
      acknowledgePaymentConfirmation({ attendeeId: "a", phone: "p", depositId: "someone-elses" })
    ).rejects.toMatchObject({ status: 404, message: "Payment confirmation not found." });
  });

  test("a network failure rejects with a retryable ApiError", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await acknowledgePaymentConfirmation({ attendeeId: "a", phone: "p", depositId: "d" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isRetryable).toBe(true);
  });
});

describe("fetchCustomerPaymentOptions", () => {
  test("posts { attendeeId, phone } to the school-specific customer-options endpoint (never GET /api/payment-options)", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, paymentOptions: [{ id: "po1", amount: 500, label: "500 EGP" }] })
    );
    const options = await fetchCustomerPaymentOptions({ attendeeId: "atd1", phone: "01012345678" });

    const [url, requestOptions] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/payments\/customer-options$/);
    expect(requestOptions.method).toBe("POST");
    expect(JSON.parse(requestOptions.body)).toEqual({ attendeeId: "atd1", phone: "01012345678" });
    expect(options).toEqual([{ id: "po1", amount: 500, label: "500 EGP" }]);
  });

  test("never sends a schoolId — the backend resolves it server-side", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, paymentOptions: [] }));
    await fetchCustomerPaymentOptions({ attendeeId: "atd1", phone: "01012345678" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("schoolId");
  });

  test("returns [] when the School has no enabled options (or full payment is confirmed)", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, paymentOptions: [] }));
    expect(await fetchCustomerPaymentOptions({ attendeeId: "a", phone: "p" })).toEqual([]);
  });

  test("strips any extra fields a response might carry (schoolId, enabled, displayOrder, timestamps)", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        paymentOptions: [
          { id: "po1", amount: 500, label: "500 EGP", schoolId: "school1", enabled: true, displayOrder: 1, createdAt: "x", updatedAt: "y", __v: 0 }
        ]
      })
    );
    const [option] = await fetchCustomerPaymentOptions({ attendeeId: "a", phone: "p" });
    expect(option).toEqual({ id: "po1", amount: 500, label: "500 EGP" });
  });

  test("surfaces the generic ownership-mismatch error", async () => {
    fetch.mockResolvedValue(jsonResponse(404, { success: false, message: "We couldn't verify this account. Check your details and try again." }));
    await expect(fetchCustomerPaymentOptions({ attendeeId: "a", phone: "wrong" })).rejects.toMatchObject({ status: 404 });
  });

  test("keeps every option the backend returns, including amounts above the ticket price", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, paymentOptions: [{ id: "a", amount: 500, label: null }, { id: "b", amount: 7000, label: "Full + extras" }] })
    );
    const options = await fetchCustomerPaymentOptions({ attendeeId: "a", phone: "p" });
    expect(options).toEqual([
      { id: "a", amount: 500, label: null },
      { id: "b", amount: 7000, label: "Full + extras" }
    ]);
  });
});

describe("createDeposit", () => {
  test("posts multipart with exactly attendeeId, phone, paymentOptionId, paymentProof — never amount", async () => {
    fetch.mockResolvedValue(
      jsonResponse(201, {
        success: true,
        message: "Deposit created.",
        deposit: { id: "dep1", amount: 500, label: "500 EGP", status: "pending", createdAt: "2026-01-05T00:00:00.000Z" }
      })
    );
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    const result = await createDeposit({ attendeeId: "atd1", phone: "01012345678", paymentOptionId: "po1", paymentProof: proof });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/deposits$/);
    expect(options.method).toBe("POST");
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("attendeeId")).toBe("atd1");
    expect(options.body.get("phone")).toBe("01012345678");
    expect(options.body.get("paymentOptionId")).toBe("po1");
    expect(options.body.get("paymentProof")).toBeInstanceOf(File);
    expect(options.body.has("amount")).toBe(false);
    expect(options.body.has("ticketPrice")).toBe(false);
    expect(options.body.has("status")).toBe(false);
    expect(Array.from(options.body.keys())).toEqual(["attendeeId", "phone", "paymentOptionId", "paymentProof"]);

    expect(result.deposit).toEqual({ id: "dep1", amount: 500, label: "500 EGP", status: "pending", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  test("strips proof/internal fields from the created-deposit response", async () => {
    fetch.mockResolvedValue(
      jsonResponse(201, {
        success: true,
        deposit: {
          id: "dep1",
          amount: 500,
          label: "500 EGP",
          status: "pending",
          createdAt: "x",
          paymentProof: { url: "https://cdn/x.jpg" },
          activeSlot: 3,
          attendeeId: "atd1"
        }
      })
    );
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    const { deposit } = await createDeposit({ attendeeId: "atd1", phone: "01012345678", paymentOptionId: "po1", paymentProof: proof });
    expect(deposit).toEqual({ id: "dep1", amount: 500, label: "500 EGP", status: "pending", createdAt: "x" });
  });

  test("surfaces the wrong-phone ownership error", async () => {
    fetch.mockResolvedValue(jsonResponse(404, { success: false, message: "We couldn't verify this account. Check your details and try again." }));
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    await expect(
      createDeposit({ attendeeId: "atd1", phone: "wrong", paymentOptionId: "po1", paymentProof: proof })
    ).rejects.toMatchObject({ status: 404, message: "We couldn't verify this account. Check your details and try again." });
  });

  test("surfaces the full-payment-confirmed 422", async () => {
    fetch.mockResolvedValue(jsonResponse(422, { success: false, message: "Full payment has already been confirmed." }));
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    await expect(
      createDeposit({ attendeeId: "atd1", phone: "01012345678", paymentOptionId: "po1", paymentProof: proof })
    ).rejects.toMatchObject({ status: 422, message: "Full payment has already been confirmed." });
  });

  test("surfaces the one-payment-at-a-time 409", async () => {
    fetch.mockResolvedValue(jsonResponse(409, { success: false, message: "You already have a payment in progress." }));
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    await expect(
      createDeposit({ attendeeId: "atd1", phone: "01012345678", paymentOptionId: "po1", paymentProof: proof })
    ).rejects.toMatchObject({ status: 409, message: "You already have a payment in progress." });
  });

  test("a network failure during submit is a retryable ApiError (state is preserved by the caller, not here)", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const proof = new File(["x"], "proof.jpg", { type: "image/jpeg" });
    const error = await createDeposit({ attendeeId: "atd1", phone: "01012345678", paymentOptionId: "po1", paymentProof: proof }).catch((e) => e);
    expect(error.kind).toBe("network");
    expect(error.isRetryable).toBe(true);
  });
});

describe("fetchInstaPayLink", () => {
  test("GETs the shared public settings endpoint and returns instapayLink", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, instapayLink: "https://ipn.eg/alshayeb-real" }));
    const link = await fetchInstaPayLink();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/settings\/public$/);
    expect(link).toBe("https://ipn.eg/alshayeb-real");
  });

  test("the backend's own example placeholder is treated as NOT configured (returns null, never the fake link)", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, instapayLink: "https://instapay.example/alshayeb" }));
    expect(await fetchInstaPayLink()).toBeNull();
  });

  test("a missing/empty instapayLink returns null", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, instapayLink: "" }));
    expect(await fetchInstaPayLink()).toBeNull();

    fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    expect(await fetchInstaPayLink()).toBeNull();
  });

  test("whitespace-only instapayLink is treated as not configured", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, instapayLink: "   " }));
    expect(await fetchInstaPayLink()).toBeNull();
  });
});
