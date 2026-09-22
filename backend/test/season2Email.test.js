// Unit tests for the Season 2 transactional email module (src/utils/season2Email.js).
// No live Mongo, no real Resend call ever: the Resend constructor is replaced
// on the `resend` module object itself (module.Resend = FakeResend), which
// works because season2Email.js reads resendPkg.Resend at send time rather
// than destructuring it at module scope — see the comment at the top of that
// file. No network traffic leaves this process.
//
// Run with:  npm test

process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const resendPkg = require("resend");

const {
  SEASON2_RETURNING_URL,
  escapeHtml,
  generateSeason2EmailHTML,
  generateSeason2EmailText,
  sendSeason2Email,
  sendSeason2RegistrationReceivedEmail,
  sendSeason2PaymentUnderReviewEmail,
  sendSeason2PaymentConfirmedEmail,
  sendSeason2PaymentRejectedEmail,
  sendSeason2FullPaymentCompleteEmail
} = require("../src/utils/season2Email");

// ---------------------------------------------------------------------------
// Fake Resend harness
// ---------------------------------------------------------------------------

function installFakeResend({ failWith = null } = {}) {
  const calls = [];
  const originalResend = resendPkg.Resend;

  resendPkg.Resend = class FakeResend {
    constructor(apiKey) {
      this.apiKey = apiKey;
    }

    get emails() {
      return {
        send: async (payload, options) => {
          calls.push({ payload, options, apiKey: this.apiKey });
          if (failWith) {
            return { data: null, error: failWith };
          }
          return { data: { id: "fake-email-id" }, error: null };
        }
      };
    }
  };

  return {
    calls,
    restore: () => {
      resendPkg.Resend = originalResend;
    }
  };
}

function withResendKey(fn) {
  const original = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-resend-key";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original;
    });
}

// ---------------------------------------------------------------------------
// Template shell
// ---------------------------------------------------------------------------

test("generateSeason2EmailHTML / generateSeason2EmailText", async (t) => {
  await t.test("escapes customer-provided values (fullName-derived greeting, rejectionReason)", () => {
    const html = generateSeason2EmailHTML({
      heading: "PAYMENT NEEDS YOUR ATTENTION",
      bodyLines: [
        "Hi <script>alert(1)</script>,",
        'Reason: "not matching" & <b>bold</b>'
      ],
      cta: { label: "CHECK YOUR STATUS", url: SEASON2_RETURNING_URL }
    });

    assert.ok(!html.includes("<script>alert(1)</script>"), "raw script tag must never appear unescaped");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("&quot;not matching&quot;"));
    assert.ok(html.includes("&amp;"));
    assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt;"));
  });

  await t.test("escapes the heading too, defense in depth", () => {
    const html = generateSeason2EmailHTML({
      heading: "<img src=x onerror=alert(1)>",
      bodyLines: ["Hi there,"],
      cta: null
    });
    assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  });

  await t.test("CTA renders the exact label and URL, also escaped", () => {
    const html = generateSeason2EmailHTML({
      heading: "REGISTRATION RECEIVED",
      bodyLines: ["Hi Marina,"],
      cta: { label: "RETURN TO ALSHAYEB EXPERIENCE", url: SEASON2_RETURNING_URL }
    });
    assert.ok(html.includes(SEASON2_RETURNING_URL));
    assert.ok(html.includes("RETURN TO ALSHAYEB EXPERIENCE"));
  });

  await t.test("omits the CTA block entirely when none is given", () => {
    const html = generateSeason2EmailHTML({ heading: "X", bodyLines: ["Y"], cta: null });
    assert.ok(!html.includes("<a href"));
  });

  await t.test("never contains legacy Selection Committee copy, Rooms copy, or QR/Ticket wording", () => {
    const html = generateSeason2EmailHTML({
      heading: "PAYMENT CONFIRMED",
      bodyLines: ["Hi Marina,", "Your payment has been approved."],
      cta: { label: "CHECK YOUR STATUS", url: SEASON2_RETURNING_URL }
    });
    const text = generateSeason2EmailText({
      heading: "PAYMENT CONFIRMED",
      bodyLines: ["Hi Marina,", "Your payment has been approved."],
      cta: { label: "CHECK YOUR STATUS", url: SEASON2_RETURNING_URL }
    });
    for (const forbidden of [
      "Selection Committee",
      "ALSHAYEB ROOMS",
      "ROOM REGISTRATION",
      "trackLookup",
      "QR",
      "Ticket Access",
      "ticket/access"
    ]) {
      assert.ok(!html.includes(forbidden), `HTML leaked "${forbidden}"`);
      assert.ok(!text.includes(forbidden), `text leaked "${forbidden}"`);
    }
  });

  await t.test("mobile-safe markup: single-column table-free shell with an explicit viewport meta tag", () => {
    const html = generateSeason2EmailHTML({ heading: "X", bodyLines: ["Y"], cta: null });
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes("max-width: 480px"));
    assert.ok(!/<table/i.test(html), "no layout tables — a simple div shell");
  });

  await t.test("plain-text fallback carries the same content, no HTML tags", () => {
    const text = generateSeason2EmailText({
      heading: "FULL PAYMENT COMPLETE",
      bodyLines: ["Hi Marina,", "Your full payment has been confirmed."],
      cta: { label: "CHECK YOUR STATUS", url: SEASON2_RETURNING_URL }
    });
    assert.ok(text.includes("FULL PAYMENT COMPLETE"));
    assert.ok(text.includes("Your full payment has been confirmed."));
    assert.ok(text.includes(SEASON2_RETURNING_URL));
    assert.ok(!/<[a-z][\s\S]*>/i.test(text), "plain text must contain no HTML tags");
  });
});

test("escapeHtml", async (t) => {
  await t.test("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });
  await t.test("handles null/undefined safely", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });
});

// ---------------------------------------------------------------------------
// sendSeason2Email — low-level, never throws
// ---------------------------------------------------------------------------

test("sendSeason2Email", async (t) => {
  await t.test("skips with a structured result when Resend is not configured (no key)", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendSeason2Email({
      to: "customer@example.com",
      subject: "Test",
      heading: "TEST",
      bodyLines: ["Hi"],
      cta: null,
      idempotencyKey: "season2-test-1"
    });
    assert.deepEqual(result, { sent: false, reason: "resend-not-configured" });
  });

  await t.test("skips with a structured result when there is no recipient", async () =>
    withResendKey(async () => {
      const result = await sendSeason2Email({
        to: undefined,
        subject: "Test",
        heading: "TEST",
        bodyLines: ["Hi"],
        cta: null,
        idempotencyKey: "season2-test-2"
      });
      assert.deepEqual(result, { sent: false, reason: "no-recipient" });
    })
  );

  await t.test("sends via Resend with the deterministic idempotency key, {sent: true} on success", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        const result = await sendSeason2Email({
          to: "customer@example.com",
          subject: "REGISTRATION RECEIVED — ALSHAYEB EXPERIENCE",
          heading: "REGISTRATION RECEIVED",
          bodyLines: ["Hi Marina,", "Your registration has been received."],
          cta: { label: "RETURN TO ALSHAYEB EXPERIENCE", url: SEASON2_RETURNING_URL },
          idempotencyKey: "season2-registration-abc123"
        });

        assert.deepEqual(result, { sent: true });
        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].payload.from, "ALSHAYEB EXPERIENCE <selection@alshayebexperience.com>");
        assert.deepEqual(fake.calls[0].payload.to, ["customer@example.com"]);
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-registration-abc123");
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("a provider-side rejection returns {sent: false} and never throws", async () =>
    withResendKey(async () => {
      const fake = installFakeResend({ failWith: { statusCode: 422, name: "validation_error", message: "bad" } });
      try {
        const result = await sendSeason2Email({
          to: "customer@example.com",
          subject: "Test",
          heading: "TEST",
          bodyLines: ["Hi"],
          cta: null,
          idempotencyKey: "season2-test-3"
        });
        assert.deepEqual(result, { sent: false, reason: "provider-error" });
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("an unexpected SDK exception returns {sent: false} and never throws or crashes the caller", async () =>
    withResendKey(async () => {
      const originalResend = resendPkg.Resend;
      resendPkg.Resend = class ThrowingResend {
        get emails() {
          return {
            send: async () => {
              throw new Error("socket hang up");
            }
          };
        }
      };
      try {
        const result = await sendSeason2Email({
          to: "customer@example.com",
          subject: "Test",
          heading: "TEST",
          bodyLines: ["Hi"],
          cta: null,
          idempotencyKey: "season2-test-4"
        });
        assert.deepEqual(result, { sent: false, reason: "unexpected-error" });
      } finally {
        resendPkg.Resend = originalResend;
      }
    })
  );
});

// ---------------------------------------------------------------------------
// The five dispatcher functions — idempotency key format + safe-field-only input
// ---------------------------------------------------------------------------

test("event dispatchers build the documented deterministic idempotency keys", async (t) => {
  await t.test("A. registration uses season2-registration-{attendeeId}", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2RegistrationReceivedEmail({ attendeeId: "attendee-1", email: "a@example.com", fullName: "Marina Adel" });
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-registration-attendee-1");
        assert.equal(fake.calls[0].payload.subject, "REGISTRATION RECEIVED — ALSHAYEB EXPERIENCE");
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("B. payment proof uses season2-proof-{depositId}", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2PaymentUnderReviewEmail({ depositId: "deposit-1", email: "a@example.com", fullName: "Marina" });
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-proof-deposit-1");
        assert.equal(fake.calls[0].payload.subject, "PAYMENT UNDER REVIEW — ALSHAYEB EXPERIENCE");
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("C. approval uses season2-approved-{depositId}", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2PaymentConfirmedEmail({ depositId: "deposit-2", email: "a@example.com", fullName: "Marina" });
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-approved-deposit-2");
        assert.equal(fake.calls[0].payload.subject, "PAYMENT CONFIRMED — ALSHAYEB EXPERIENCE");
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("D. rejection uses season2-rejected-{depositId} and escapes rejectionReason", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2PaymentRejectedEmail({
          depositId: "deposit-3",
          email: "a@example.com",
          fullName: "Marina",
          rejectionReason: '<script>alert(1)</script> & "quoted"'
        });
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-rejected-deposit-3");
        assert.equal(fake.calls[0].payload.subject, "PAYMENT NEEDS YOUR ATTENTION — ALSHAYEB EXPERIENCE");
        assert.ok(!fake.calls[0].payload.html.includes("<script>alert(1)</script>"));
        assert.ok(fake.calls[0].payload.html.includes("&lt;script&gt;"));
        assert.ok(fake.calls[0].payload.html.includes("&quot;quoted&quot;"));
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("E. full payment uses season2-full-payment-{attendeeId}", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2FullPaymentCompleteEmail({ attendeeId: "attendee-9", email: "a@example.com", fullName: "Marina" });
        assert.equal(fake.calls[0].options.idempotencyKey, "season2-full-payment-attendee-9");
        assert.equal(fake.calls[0].payload.subject, "FULL PAYMENT COMPLETE — ALSHAYEB EXPERIENCE");
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("firstName falls back to \"there\" for a blank fullName", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2RegistrationReceivedEmail({ attendeeId: "attendee-5", email: "a@example.com", fullName: "" });
        assert.ok(fake.calls[0].payload.text.includes("Hi there,"));
      } finally {
        fake.restore();
      }
    })
  );

  await t.test("privacy: none of the five templates ever mention QR/ticket/proof/internal fields", async () =>
    withResendKey(async () => {
      const fake = installFakeResend();
      try {
        await sendSeason2RegistrationReceivedEmail({ attendeeId: "id1", email: "a@example.com", fullName: "Marina" });
        await sendSeason2PaymentUnderReviewEmail({ depositId: "id2", email: "a@example.com", fullName: "Marina" });
        await sendSeason2PaymentConfirmedEmail({ depositId: "id3", email: "a@example.com", fullName: "Marina" });
        await sendSeason2PaymentRejectedEmail({ depositId: "id4", email: "a@example.com", fullName: "Marina", rejectionReason: "Blurry." });
        await sendSeason2FullPaymentCompleteEmail({ attendeeId: "id5", email: "a@example.com", fullName: "Marina" });

        const forbidden = [
          "qrToken",
          "qrId",
          "paymentProof",
          "publicId",
          "googleSheet",
          "Ticket Price",
          "Paid",
          "Remaining",
          "cloudinary"
        ];
        for (const call of fake.calls) {
          const serialized = call.payload.html + call.payload.text;
          for (const term of forbidden) {
            assert.ok(!serialized.includes(term), `template leaked "${term}"`);
          }
        }
      } finally {
        fake.restore();
      }
    })
  );
});
