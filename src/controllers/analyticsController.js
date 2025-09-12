const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Reply = require('../models/Reply');
const Analytics = require('../models/Analytics');
const { Parser } = require('json2csv');

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
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

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
                name: campaign.name, totalSent: 0, delivered: 0, read: 0,
                replies: campaign.replyCount || 0, deliveryRate: '0%', readRate: '0%', replyRate: '0%',
            }});
        }
        const delivered = await Analytics.countDocuments({ campaign: campaignId, status: 'delivered' });
        const read = await Analytics.countDocuments({ campaign: campaignId, status: 'read' });
        const deliveryRate = ((delivered / totalSent) * 100).toFixed(1) + '%';
        const readRate = ((read / totalSent) * 100).toFixed(1) + '%';
        const replyRate = ((campaign.replyCount / totalSent) * 100).toFixed(1) + '%';
        res.status(200).json({ success: true, data: {
            name: campaign.name, totalSent, delivered, read,
            replies: campaign.replyCount || 0, deliveryRate, readRate, replyRate,
        }});
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

const exportCampaignAnalytics = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const analyticsData = await Analytics.find({ campaign: campaignId })
            .populate('contact', 'phoneNumber name');
        if (!analyticsData || analyticsData.length === 0) {
            return res.status(404).json({ success: false, error: 'No analytics data found.' });
        }
        const fields = [
            { label: 'Phone Number', value: 'contact.phoneNumber' },
            { label: 'Contact Name', value: 'contact.name' },
            { label: 'Message ID (wamid)', value: 'wamid' },
            { label: 'Status', value: 'status' },
            { label: 'Last Updated', value: 'updatedAt' },
        ];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(analyticsData);
        res.header('Content-Type', 'text/csv');
        res.attachment(`campaign_${campaignId}_analytics.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

module.exports = {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics,
};