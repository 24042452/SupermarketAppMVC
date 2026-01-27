const fs = require("fs");
const path = require("path");

const getFetch = () => {
  if (typeof fetch === 'function') return fetch;
  return (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));
};

const getCourseInitIdParam = () => {
  try {
    require.resolve("./../course_init_id");
    const { courseInitId } = require("../course_init_id");
    console.log("Loaded courseInitId:", courseInitId);

    return courseInitId ? `${courseInitId}` : "";
  } catch (error) {
    try {
      const filePath = path.join(__dirname, "..", "course_init_id.js");
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        const match = content.match(/courseInitId\s*=\s*['"]([^'"]+)['"]/);
        if (match && match[1]) {
          console.log("Loaded courseInitId from file:", match[1]);
          return `${match[1]}`;
        }
      }
    } catch (fileErr) {
      console.error("Failed to read course_init_id.js:", fileErr.message);
    }
    return process.env.COURSE_INIT_ID ? `${process.env.COURSE_INIT_ID}` : "";
  }
};

const buildWebhookUrl = (txnRetrievalRef, courseInitId) => {
  const ref = encodeURIComponent(txnRetrievalRef || "");
  const course = encodeURIComponent(courseInitId || "");
  return `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets/webhook?txn_retrieval_ref=${ref}&course_init_id=${course}`;
};

const extractStatus = (payload) => {
  const root = payload || {};
  const data = root.result?.data || root.data || root;

  const responseCode = data.response_code || data.responseCode || root.response_code || root.responseCode || "";
  const txnStatus = data.txn_status ?? data.txnStatus ?? root.txn_status ?? root.txnStatus ?? "";
  const networkStatus = data.network_status ?? data.networkStatus ?? root.network_status ?? root.networkStatus ?? "";
  const message = data.error_message || data.message || root.error_message || root.message || "";

  return { responseCode, txnStatus, networkStatus, message, raw: data };
};

const isSuccessStatus = ({ responseCode, txnStatus, message }) => {
  const normalized = String(txnStatus).toLowerCase();
  const msg = String(message || "").toLowerCase();
  if (responseCode !== "00") return false;
  if (!txnStatus && msg.includes("qr code scanned")) return true;
  return (
    txnStatus === 2 ||
    normalized === "2" ||
    normalized === "success" ||
    normalized === "payment_success" ||
    normalized === "paid" ||
    (msg.includes("payment") && msg.includes("success")) ||
    msg.includes("successful")
  );
};

const isFailureStatus = ({ responseCode, txnStatus }) => {
  const normalized = String(txnStatus).toLowerCase();
  return (
    (responseCode && responseCode !== "00") ||
    normalized === "failed" ||
    normalized === "rejected" ||
    normalized === "cancelled" ||
    normalized === "expired"
  );
};

const requestQrData = async (cartTotal) => {
  const requestBody = {
    txn_id: "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b", // Default for testing
    amt_in_dollars: cartTotal,
    notify_mobile: 0,
  };

  const fetch = getFetch();
  const response = await fetch(
    `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.API_KEY,
        "project-id": process.env.PROJECT_ID,
      },
      body: JSON.stringify(requestBody),
    }
  );
  return response.json();
};

const createQrForTotal = async (cartTotal) => {
  return requestQrData(cartTotal);
};

const fetchPaymentStatus = async ({ txnRetrievalRef, courseInitId }) => {
  if (!txnRetrievalRef) throw new Error("Missing transaction reference");

  const fetch = getFetch();
  const webhookUrl = buildWebhookUrl(txnRetrievalRef, courseInitId);
  const response = await fetch(webhookUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.API_KEY,
      "project-id": process.env.PROJECT_ID,
    },
  });
  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (parseErr) {
    const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const dataLines = lines
      .filter(line => line.startsWith("data:"))
      .map(line => line.replace(/^data:\s?/, ""));
    const lastData = dataLines.length ? dataLines[dataLines.length - 1] : "";
    if (lastData) {
      try {
        payload = JSON.parse(lastData);
      } catch (innerErr) {
        payload = { error_message: "Non-JSON response from NETS webhook", raw: rawText };
      }
    } else {
      payload = { error_message: "Non-JSON response from NETS webhook", raw: rawText };
    }
    if (payload && payload.message) {
      console.log("NETS webhook SSE payload:", payload);
    } else {
      console.error("NETS webhook non-JSON response:", rawText.slice(0, 200));
    }
  }
  const status = extractStatus(payload);

  return {
    ok: response.ok,
    payload,
    status,
    isSuccess: isSuccessStatus(status),
    isFailure: isFailureStatus(status),
    webhookUrl,
  };
};

exports.generateQrCode = async (req, res) => {
  const { cartTotal } = req.body;
  console.log(cartTotal);
  try {
    const responseData = await requestQrData(cartTotal);
    const qrData = responseData.result.data;
    console.log({ qrData });

    if (
      qrData.response_code === "00" &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      console.log("QR code generated successfully");

      const txnRetrievalRef = qrData.txn_retrieval_ref;
      const courseInitId = getCourseInitIdParam();

      const webhookUrl = buildWebhookUrl(txnRetrievalRef, courseInitId);

      console.log("Transaction retrieval ref:" + txnRetrievalRef);
      console.log("courseInitId:" + courseInitId);
      console.log("webhookUrl:" + webhookUrl);

      req.session.netsPayment = {
        txnRetrievalRef,
        courseInitId,
        total: cartTotal,
        startedAt: Date.now(),
      };

      res.render("netsQr", {
        total: cartTotal,
        title: "Scan to Pay",
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef: txnRetrievalRef,
        courseInitId: courseInitId,
        networkCode: qrData.network_status,
        timer: 300,
        webhookUrl: webhookUrl,
        fullNetsResponse: responseData,
        apiKey: process.env.API_KEY,
        projectId: process.env.PROJECT_ID,
      });
    } else {
      let errorMsg = "An error occurred while generating the QR code.";
      if (qrData.network_status !== 0) {
        errorMsg =
          qrData.error_message || "Transaction failed. Please try again.";
      }
      res.render("netsQrFail", {
        title: "Error",
        responseCode: qrData.response_code || "N.A.",
        instructions: qrData.instruction || "",
        errorMsg: errorMsg,
      });
    }
  } catch (error) {
    console.error("Error in generateQrCode:", error.message);
    res.redirect("/nets-qr/fail");
  }
};

exports.generateQrCodeJson = async (req, res) => {
  const { cartTotal } = req.body || {};
  if (!cartTotal) return res.status(400).json({ error: "Missing cartTotal" });

  try {
    const responseData = await requestQrData(cartTotal);
    const qrData = responseData.result.data;

    if (
      qrData.response_code === "00" &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      const txnRetrievalRef = qrData.txn_retrieval_ref;
      const courseInitId = getCourseInitIdParam();
      const webhookUrl = buildWebhookUrl(txnRetrievalRef, courseInitId);

      req.session.netsPayment = {
        txnRetrievalRef,
        courseInitId,
        total: cartTotal,
        startedAt: Date.now(),
      };

      return res.json({
        ok: true,
        total: cartTotal,
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef,
        courseInitId,
        networkCode: qrData.network_status,
        timer: 300,
        webhookUrl,
        responseCode: qrData.response_code,
        instruction: qrData.instruction || "",
      });
    }

    return res.status(400).json({
      ok: false,
      responseCode: qrData.response_code || "N.A.",
      instruction: qrData.instruction || "",
      errorMsg: qrData.error_message || "Transaction failed. Please try again.",
    });
  } catch (error) {
    console.error("Error in generateQrCodeJson:", error.message);
    return res.status(500).json({ error: "Failed to generate NETS QR" });
  }
};

exports.fetchPaymentStatus = fetchPaymentStatus;
exports.extractStatus = extractStatus;
exports.createQrForTotal = createQrForTotal;
exports.getCourseInitIdParam = getCourseInitIdParam;
exports.buildWebhookUrl = buildWebhookUrl;
