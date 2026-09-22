import {
  loginAdmin,
  fetchSchools,
  createSchool,
  updateSchool,
  fetchSchoolPaymentOptions,
  createPaymentOption,
  updatePaymentOption,
  deletePaymentOption,
  fetchDeposits,
  approveDeposit,
  rejectDeposit,
  fetchFinanceConfigs,
  saveFinanceConfig,
  syncFinanceSheet,
  syncFullPayment,
  fetchAdminSettings,
  saveInstaPayLink,
  ApiError
} from "./admin.api";
import { setAdminSession, clearAdminSession } from "../state/adminSession";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  global.fetch = jest.fn();
  clearAdminSession();
});

describe("auth header", () => {
  test("every admin call attaches the stored token as a Bearer header", async () => {
    setAdminSession({ email: "a@b.com", token: "jwt-xyz" });
    fetch.mockResolvedValue(jsonResponse(200, { success: true, schools: [] }));
    await fetchSchools();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt-xyz");
  });

  test("no session → no Authorization header is sent", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, schools: [] }));
    await fetchSchools();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test("loginAdmin never attaches a token, even if one is already stored", async () => {
    setAdminSession({ email: "a@b.com", token: "old-token" });
    fetch.mockResolvedValue(jsonResponse(200, { success: true, token: "new-token", expiresIn: "8h" }));
    await loginAdmin({ email: "a@b.com", password: "pw" });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test("a 401 clears the stored admin session (expired/invalid token handling)", async () => {
    setAdminSession({ email: "a@b.com", token: "expired" });
    fetch.mockResolvedValue(jsonResponse(401, { success: false, message: "Admin session has expired. Please log in again." }));

    await expect(fetchSchools()).rejects.toMatchObject({ status: 401, kind: "auth" });
    expect(JSON.parse(window.localStorage.getItem("alshayebAdminSession") || "null")).toBeNull();
  });
});

describe("schools", () => {
  test("fetchSchools GETs /api/admin/schools", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, schools: [{ _id: "s1", name: "A", ticketPrice: 6000 }] }));
    const schools = await fetchSchools();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/schools$/);
    expect(schools).toEqual([{ _id: "s1", name: "A", ticketPrice: 6000 }]);
  });

  test("createSchool posts {name, ticketPrice}", async () => {
    fetch.mockResolvedValue(jsonResponse(201, { success: true, school: { _id: "s1", name: "A", ticketPrice: 6000 } }));
    await createSchool({ name: "A", ticketPrice: 6000 });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/schools$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ name: "A", ticketPrice: 6000 });
  });

  test("updateSchool PUTs to /api/admin/schools/:id", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, school: { _id: "s1", name: "B", ticketPrice: 5000 } }));
    await updateSchool("s1", { ticketPrice: 5000 });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/schools\/s1$/);
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual({ ticketPrice: 5000 });
  });
});

describe("payment options — always school-scoped", () => {
  test("fetchSchoolPaymentOptions GETs with ?schoolId=", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, paymentOptions: [] }));
    await fetchSchoolPaymentOptions("school-a");
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/payment-options\?schoolId=school-a$/);
  });

  test("createPaymentOption always includes schoolId in the body", async () => {
    fetch.mockResolvedValue(jsonResponse(201, { success: true, paymentOption: { _id: "po1" } }));
    await createPaymentOption({ schoolId: "school-a", amount: 500, label: "First", enabled: true, displayOrder: 1 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.schoolId).toBe("school-a");
    expect(body.amount).toBe(500);
  });

  test("updatePaymentOption PUTs to /api/admin/payment-options/:id", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, paymentOption: { _id: "po1", enabled: false } }));
    await updatePaymentOption("po1", { enabled: false });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/payment-options\/po1$/);
    expect(options.method).toBe("PUT");
  });

  test("deletePaymentOption DELETEs /api/admin/payment-options/:id", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, message: "Payment option deleted." }));
    await deletePaymentOption("po1");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/payment-options\/po1$/);
    expect(options.method).toBe("DELETE");
  });
});

describe("deposits", () => {
  test("fetchDeposits GETs with ?status= when given", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, deposits: [] }));
    await fetchDeposits({ status: "pending" });
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/deposits\?status=pending$/);
  });

  test("fetchDeposits omits the query string entirely for 'all'", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, deposits: [] }));
    await fetchDeposits({});
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/deposits$/);
  });

  test("approveDeposit PUTs /api/admin/deposits/:id/approve", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, deposit: { _id: "d1", status: "approved" } }));
    await approveDeposit("d1");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/deposits\/d1\/approve$/);
    expect(options.method).toBe("PUT");
  });

  test("approveDeposit surfaces a 409 (already reviewed) with the backend's message", async () => {
    fetch.mockResolvedValue(jsonResponse(409, { success: false, message: "This deposit was already reviewed." }));
    await expect(approveDeposit("d1")).rejects.toMatchObject({ status: 409, message: "This deposit was already reviewed." });
  });

  test("approveDeposit surfaces a 4xx with the backend's message", async () => {
    fetch.mockResolvedValue(jsonResponse(404, { success: false, message: "Associated attendee was not found." }));
    await expect(approveDeposit("d1")).rejects.toMatchObject({ status: 404, message: "Associated attendee was not found." });
  });

  test("updateSchool sends the ticket-price visibility flag as-is", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, school: { _id: "s1", showTicketPriceToCustomer: false } }));
    await updateSchool("s1", { showTicketPriceToCustomer: false });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ showTicketPriceToCustomer: false });
  });

  test("rejectDeposit PUTs with {rejectionReason}", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, deposit: { _id: "d1", status: "rejected" } }));
    await rejectDeposit("d1", { rejectionReason: "Blurry screenshot" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/deposits\/d1\/reject$/);
    expect(JSON.parse(options.body)).toEqual({ rejectionReason: "Blurry screenshot" });
  });
});

describe("finance config + sync", () => {
  test("fetchFinanceConfigs GETs the list endpoint (not per-school)", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, configs: [] }));
    await fetchFinanceConfigs();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/school-finance-config$/);
  });

  test("saveFinanceConfig PUTs to /:schoolId", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, config: { schoolId: "s1", googleSheetId: "sheet1" } }));
    await saveFinanceConfig("s1", { googleSheetId: "sheet1", tabName: "Sheet1", enabled: true });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/school-finance-config\/s1$/);
    expect(options.method).toBe("PUT");
  });

  test("syncFinanceSheet POSTs to /:schoolId/sync and returns the raw result shape", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, syncedCount: 3, updated: 1, appended: 2 }));
    const result = await syncFinanceSheet("s1");
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/school-finance-config\/s1\/sync$/);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(result).toEqual({ success: true, syncedCount: 3, updated: 1, appended: 2 });
  });

  test("syncFinanceSheet surfaces a skipped result (e.g. Google not configured) without throwing", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: false, skipped: true, reason: "Google Service Account is not configured." }));
    const result = await syncFinanceSheet("s1");
    expect(result).toEqual({ success: false, skipped: true, reason: "Google Service Account is not configured." });
  });

  test("syncFullPayment POSTs to /:schoolId/sync-full-payment", async () => {
    fetch.mockResolvedValue(
      jsonResponse(200, { success: true, syncedCount: 5, confirmedCount: 2, unconfirmedCount: 3, skippedUnknown: [], skippedWrongSchool: [], duplicateCustomerIds: [] })
    );
    const result = await syncFullPayment("s1");
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/school-finance-config\/s1\/sync-full-payment$/);
    expect(result.confirmedCount).toBe(2);
  });
});

describe("settings (InstaPay link)", () => {
  test("fetchAdminSettings GETs /api/admin/site-settings", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, settings: { instapayLink: "https://real" } }));
    const settings = await fetchAdminSettings();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/site-settings$/);
    expect(settings.instapayLink).toBe("https://real");
  });

  test("saveInstaPayLink PUTs to the SHARED /api/admin/settings endpoint — no new settings storage", async () => {
    fetch.mockResolvedValue(jsonResponse(200, { success: true, settings: { instapayLink: "https://real" } }));
    await saveInstaPayLink("https://real");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/settings$/);
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual({ instapayLink: "https://real" });
  });
});

describe("error handling shared with the rest of Season 2", () => {
  test("a network failure becomes a retryable network ApiError", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await fetchSchools().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.isRetryable).toBe(true);
  });

  test("hides raw 5xx messages", async () => {
    fetch.mockResolvedValue(jsonResponse(500, { success: false, message: "stack trace leak" }));
    const error = await fetchSchools().catch((e) => e);
    expect(error.message).not.toMatch(/stack/);
    expect(error.isRetryable).toBe(true);
  });
});
