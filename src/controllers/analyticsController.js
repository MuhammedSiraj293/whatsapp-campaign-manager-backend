// backend/src/controllers/analyticsController.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Reply = require('../models/Reply');
const Analytics = require('../models/Analytics');

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

// @desc    Get aggregated stats for a single campaign
const getCampaignAnalytics = async (req, res) => {
    try {
        const { campaignId } = req.params;

        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }

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

        const delivered = await Analytics.countDocuments({ campaign: campaignId, status: 'delivered' });
        const read = await Analytics.countDocuments({ campaign: campaignId, status: 'read' });

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


module.exports = {
  getStats,
  getCampaignAnalytics,
};