// backend/src/jobs/scheduler.js

const cron = require("node-cron");
const Campaign = require("../models/Campaign");
const { sendCampaign } = require("../services/campaignService");
const Log = require("../models/Log");

const startScheduler = () => {
  // This cron job runs every minute to check for scheduled campaigns
  cron.schedule("* * * * *", async () => {
   console.log('🕒 Checking for scheduled campaigns...');
    try {
      // Find campaigns that are 'scheduled' and whose time is in the past.
      const campaignsToSend = await Campaign.find({
        status: "scheduled",
        scheduledFor: { $lte: new Date() },
      });

      for (const campaign of campaignsToSend) {
        console.log(`Found campaign to send: ${campaign.name}`);

        // --- THIS IS THE KEY CHANGE ---
        // Immediately update the campaign's status to 'sending' to lock it
        campaign.status = "sending";
        await campaign.save();

        await Log.create({
          level: "info",
          message: `Scheduler picked up campaign "${campaign.name}" and set status to 'sending'.`,
          campaign: campaign._id,
        });

        // Now, start the sending process in the background
        sendCampaign(campaign._id).catch(async (error) => {
          console.error(`Error sending campaign ${campaign._id}:`, error);
          campaign.status = "failed"; // Mark as failed if the service throws an error
          await campaign.save();
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
