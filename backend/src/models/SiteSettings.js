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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
