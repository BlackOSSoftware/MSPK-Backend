import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import User from "../src/models/User.js";
import UserSubscription from "../src/models/UserSubscription.js";
import Subscription from "../src/models/Subscription.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

const id = "69ab01301364071c07793fee";
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const user = await User.findById(id)
    .select("_id name email phone phoneNumber isWhatsAppEnabled preferredSegments marketWatchlists activeMarketWatchlistId")
    .lean();
  console.log(user ? JSON.stringify(user, null, 2) : "user not found");
  const subs = await UserSubscription.find({
    user_id: id,
    status: "active",
    is_active: true,
    end_date: { $gt: new Date() }
  }).lean();
  console.log("userSubscriptions", subs.length);
  const subs2 = await Subscription.find({
    user: id,
    status: "active",
    endDate: { $gt: new Date() }
  }).populate("plan").lean();
  console.log("subscriptions", subs2.length);
  await mongoose.disconnect();
} catch (err) {
  console.error(err);
  process.exit(1);
}
