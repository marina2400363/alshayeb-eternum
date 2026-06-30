const mongoose = require("mongoose");

const siteSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default"
    },
    outcomerSelection: {
      approved: {
        type: Number,
        default: 129
      },
      pending: {
        type: Number,
        default: 73
      },
      declined: {
        type: Number,
        default: 46
      }
    },
    guestListDisplayCount: {
      type: Number,
      default: 137,
      min: 0
    },
    instapayLink: {
      type: String,
      default: "https://instapay.example/alshayeb"
    },
    roomsInstapayLink: {
      type: String,
      default: "instapay://pay?pa=alshayeb@instapay"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
