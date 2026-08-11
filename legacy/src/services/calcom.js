function getCalcomEventConfig() {
  const eventTypeId = (process.env.CALCOM_EVENT_TYPE_ID || "").trim();
  const username = (process.env.CALCOM_USERNAME || "").trim();
  const eventTypeSlug = (process.env.CALCOM_EVENT_TYPE_SLUG || "").trim();

  if (eventTypeId && /^\d+$/.test(eventTypeId)) {
    return { eventTypeId: Number(eventTypeId) };
  }

  if (username && eventTypeSlug) {
    return { username, eventTypeSlug };
  }

  throw new Error("Missing Cal.com event config: set CALCOM_USERNAME and CALCOM_EVENT_TYPE_SLUG, or numeric CALCOM_EVENT_TYPE_ID");
}

async function scheduleCalcomBooking(args) {
  if (!process.env.CALCOM_API_KEY) {
    throw new Error("Missing CALCOM_API_KEY");
  }

  const start = args.start || args.startTime || args.preferred_datetime || args.preferredDateTime;
  const name = args.name || args.lead_name || "Qualified lead";
  const email = args.email || args.lead_email;
  const phone = args.phone || args.lead_phone || args.phone_number;
  const notes = args.notes || args.reason || "Follow-up requested by qualified lead during Vapi call.";

  if (!start) {
    throw new Error("Missing preferred date/time for Cal.com booking");
  }

  // VERIFY AGAINST CURRENT CAL.COM DOCS: Cal.com's v2 booking payload can vary by account,
  // routing form, location, and attendee fields. Confirm this shape before a live demo.
  const payload = {
    ...getCalcomEventConfig(),
    start,
    attendee: {
      name,
      email,
      timeZone: args.timeZone || args.timezone || "UTC",
      phoneNumber: phone
    },
    metadata: {
      notes
    }
  };

  try {
    const response = await fetch("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
        "cal-api-version": "2024-06-14"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    const responseBody = responseText ? JSON.parse(responseText) : {};

    if (!response.ok) {
      throw new Error(`Cal.com responded ${response.status}: ${responseText}`);
    }

    return responseBody;
  } catch (error) {
    console.error("Cal.com API call failed:", error);
    throw error;
  }
}

module.exports = { scheduleCalcomBooking };
