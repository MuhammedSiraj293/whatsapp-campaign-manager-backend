// backend/src/jobs/scheduler.js

const cron = require("node-cron");
const Campaign = require("../models/Campaign");
const Enquiry = require("../models/Enquiry");
const { sendCampaign } = require("../services/campaignService");
const { checkAndSendFollowUps } = require("../services/followUpScheduler");
const Log = require("../models/Log");
const { getIO } = require("../socketManager");

const startScheduler = () => {
  console.log('⏰ Starting all schedulers...');

  // ---------------------------------------------------------
  // 1. CAMPAIGN SCHEDULER (Runs every 1 minute)
  // ---------------------------------------------------------
  cron.schedule("* * * * *", async () => {
    // console.log("🕒 Checking for scheduled campaigns...");
    try {
      const io = getIO();
      const campaignsToSend = await Campaign.find({
        status: "scheduled",
        scheduledFor: { $lte: new Date() },
      });

      for (const campaign of campaignsToSend) {
        console.log(`Found campaign to send: ${campaign.name}`);

        campaign.status = "sending";
        await campaign.save();

        io.emit("campaignsUpdated");

        await Log.create({
          level: "info",
          message: `Scheduler picked up campaign "${campaign.name}" and set status to 'sending'.`,
          campaign: campaign._id,
        });

        sendCampaign(campaign._id).catch(async (error) => {
          console.error(`Error sending campaign ${campaign._id}:`, error);
          const failedCampaign = await Campaign.findById(campaign._id);
          if (failedCampaign) {
            failedCampaign.status = "failed";
            await failedCampaign.save();
            io.emit("campaignsUpdated");
          }

          await Log.create({
            level: "error",
            message: `Campaign "${campaign.name}" failed during execution. Reason: ${error.message}`,
            campaign: campaign._id,
          });
        });
      }
    } catch (error) {
      console.error("Error in campaign scheduler:", error);
    }
  });

  // ---------------------------------------------------------
  // 2. INACTIVITY TIMEOUT SCHEDULER (Runs every 1 minute)
  // Ends conversation if inactive for 15 minutes
  // ---------------------------------------------------------
  cron.schedule("* * * * *", async () => {
    // console.log("💤 Checking for inactive enquiries...");
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      
      // Find enquiries that are active (not END) and haven't been updated in 15 mins
      const inactiveEnquiries = await Enquiry.find({
        conversationState: { $ne: "END" },
        updatedAt: { $lt: fifteenMinutesAgo }
      });

      if (inactiveEnquiries.length > 0) {
        console.log(`Found ${inactiveEnquiries.length} inactive enquiries. Ending them silently.`);
        
        for (const enquiry of inactiveEnquiries) {
          enquiry.conversationState = "END";
          enquiry.endedAt = new Date();
          // We do NOT set endMessageSent=true because we didn't send one.
          await enquiry.save();

          await Log.create({
            level: "info",
            message: `Enquiry for ${enquiry.phoneNumber} ended due to inactivity (15 mins).`,
          });
        }
      }
    } catch (error) {
      console.error("Error in inactivity scheduler:", error);
    }
  });

  // ---------------------------------------------------------
  // 3. FOLLOW-UP SCHEDULER (Runs every 1 minute)
  // Checks for enquiries created > 45 mins ago needing follow-up
  // ---------------------------------------------------------
  cron.schedule("* * * * *", async () => {
    // console.log("⏰ Running follow-up check...");
    await checkAndSendFollowUps();
  });

  // Run initial follow-up check after 10 seconds (catch any missed ones on restart)
  setTimeout(async () => {
    console.log('🚀 Running initial follow-up check...');
    await checkAndSendFollowUps();
  }, 10000);
};

module.exports = {
  startScheduler,
};
