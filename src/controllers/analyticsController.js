// backend/src/controllers/analyticsController.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Reply = require('../models/Reply');
const Analytics = require('../models/Analytics'); 
const { Parser } = require('json2csv'); // <-- Import Analytics model

// @desc    Get key analytics stats
const getStats = async (req, res) => {
  try {
    const [campaignCount, contactCount, replyCount] = await Promise.all([
      Campaign.countDocuments({ status: 'sent' }),
      Contact.countDocuments(),
      Reply.countDocuments({ direction: 'incoming' }),
    ]);

    res.status(200).json({ success: true, data: {
        campaignsSent: campaignCount,
        totalContacts: contactCount,
        repliesReceived: replyCount,
    }});
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// --- NEW FUNCTION TO GET PER-CAMPAIGN STATS ---
const getCampaignAnalytics = async (req, res) => {
    try {
        const { campaignId } = req.params;

        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }

        // Get total messages sent for this campaign
        const totalSent = await Analytics.countDocuments({ campaign: campaignId });

        if (totalSent === 0) {
            return res.status(200).json({ success: true, data: {
                name: campaign.name,
                totalSent: 0,
                delivered: 0,
                read: 0,
                replies: campaign.replyCount || 0,
                deliveryRate: '0%',
                readRate: '0%',
                replyRate: '0%',
            }});
        }

        // Get counts for each status
        const delivered = await Analytics.countDocuments({ campaign: campaignId, status: 'delivered' });
        const read = await Analytics.countDocuments({ campaign: campaignId, status: 'read' });

        // Calculate rates
        const deliveryRate = ((delivered / totalSent) * 100).toFixed(1) + '%';
        const readRate = ((read / totalSent) * 100).toFixed(1) + '%';
        const replyRate = ((campaign.replyCount / totalSent) * 100).toFixed(1) + '%';

        res.status(200).json({ success: true, data: {
            name: campaign.name,
            totalSent,
            delivered,
            read,
            replies: campaign.replyCount || 0,
            deliveryRate,
            readRate,
            replyRate,
        }});

    } catch (error) {
        console.error('Error fetching campaign analytics:', error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// --- NEW FUNCTION TO EXPORT CAMPAIGN DATA ---
const exportCampaignAnalytics = async (req, res) => {
    try {
        const { campaignId } = req.params;

        // Find all analytics events for this campaign and populate the contact info
        const analyticsData = await Analytics.find({ campaign: campaignId })
            .populate('contact', 'phoneNumber name');

        if (!analyticsData || analyticsData.length === 0) {
            return res.status(404).json({ success: false, error: 'No analytics data found for this campaign.' });
        }

        // Define the columns for our CSV file
        const fields = [
            { label: 'Phone Number', value: 'contact.phoneNumber' },
            { label: 'Contact Name', value: 'contact.name' },
            { label: 'Message ID (wamid)', value: 'wamid' },
            { label: 'Status', value: 'status' },
            { label: 'Last Updated', value: 'updatedAt' },
        ];

        // Create a new CSV parser and convert the data
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(analyticsData);

        // Set the headers to tell the browser to download the file
        res.header('Content-Type', 'text/csv');
        res.attachment(`campaign_${campaignId}_analytics.csv`);
        res.send(csv);

    } catch (error) {
        console.error('Error exporting campaign analytics:', error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};


module.exports = {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics, // <-- EXPORT NEW FUNCTION
  };