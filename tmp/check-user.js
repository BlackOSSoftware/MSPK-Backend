const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}
const id = "69ab01301364071c07793fee";
mongoose.connect(uri).then(async () => {
  const User = require("../models/User.js");
  const user = await User.findById(id)
    .select("_id name email phone phoneNumber isWhatsAppEnabled preferredSegments marketWatchlists activeMarketWatchlistId")
    .lean();
  console.log(user ? JSON.stringify(user, null, 2) : "user not found");
  const UserSubscription = require("../models/UserSubscription.js");
  const sub = await UserSubscription.find({
    user_id: id,
    status: "active",
    is_active: true,
    end_date: { $gt: new Date() }
  }).lean();
  console.log("userSubscriptions", sub.length);
  const Subscription = require("../models/Subscription.js");
  const sub2 = await Subscription.find({
    user: id,
    status: "active",
    endDate: { $gt: new Date() }
  }).populate("plan").lean();
  console.log("subscriptions", sub2.length);
  await mongoose.disconnect();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
