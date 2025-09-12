// backend/src/jobs/scheduler.js

const cron = require('node-cron');
const Campaign = require('../models/Campaign');
const { sendCampaign } = require('../services/campaignService');

const startScheduler = () => {
  // This cron expression means the job will run every minute.
  cron.schedule('* * * * *', async () => {
    console.log('🕒 Checking for scheduled campaigns...');

    try {
      // Find campaigns that are 'scheduled' and whose time is in the past.
      const dueCampaigns = await Campaign.find({
        status: 'scheduled',
        scheduledFor: { $lte: new Date() },
      });

      if (dueCampaigns.length > 0) {
        console.log(`🚀 Found ${dueCampaigns.length} campaigns to send.`);
      }

      // Loop through each due campaign and send it.
      for (const campaign of dueCampaigns) {
        console.log(`Processing campaign: ${campaign.name}`);
        try {
          // The sendCampaign service now handles setting the status to 'sent'.
          await sendCampaign(campaign._id); 
          console.log(`✅ Campaign "${campaign.name}" sent successfully.`);
        } catch (error) {
          console.error(`❌ Failed to send campaign "${campaign.name}":`, error);
          // If sending fails, mark it as 'failed'.
          const failedCampaign = await Campaign.findById(campaign._id);
          if (failedCampaign) {
              failedCampaign.status = 'failed';
              await failedCampaign.save();
          }
        }
      }
    } catch (error) {
      console.error('Error during scheduled campaign check:', error);
    }
  });
};

module.exports = { startScheduler };