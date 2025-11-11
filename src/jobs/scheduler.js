// backend/src/jobs/scheduler.js

const cron = require("node-cron");
const Campaign = require("../models/Campaign");
const { sendCampaign } = require("../services/campaignService");
const Log = require("../models/Log");
const { getIO } = require("../socketManager"); // <-- 1. IMPORT Socket.IO

const startScheduler = () => {
  cron.schedule("* * * * *", async () => {
    console.log("🕒 Checking for scheduled campaigns...");
    try {
      const io = getIO(); // <-- 2. GET the io instance
      const campaignsToSend = await Campaign.find({
        status: "scheduled",
        scheduledFor: { $lte: new Date() },
      });

      for (const campaign of campaignsToSend) {
        console.log(`Found campaign to send: ${campaign.name}`);

        campaign.status = "sending";
        await campaign.save();

        io.emit("campaignsUpdated"); // <-- 3. EMIT real-time update

        await Log.create({
          level: "info",
          message: `Scheduler picked up campaign "${campaign.name}" and set status to 'sending'.`,
          campaign: campaign._id,
        });

        sendCampaign(campaign._id).catch(async (error) => {
          console.error(`Error sending campaign ${campaign._id}:`, error);
          // Find the campaign again to be safe
          const failedCampaign = await Campaign.findById(campaign._id);
          if (failedCampaign) {
            failedCampaign.status = "failed";
            await failedCampaign.save();
            io.emit("campaignsUpdated"); // <-- 4. EMIT real-time update on failure
          }

          await Log.create({
            level: "error",
            message: `Campaign "${campaign.name}" failed during execution. Reason: ${error.message}`,
            campaign: campaign._id,
          });
        });
      }
    } catch (error) {
      console.error("Error in scheduler:", error);
    }
  });
};

module.exports = {
  startScheduler,
};
