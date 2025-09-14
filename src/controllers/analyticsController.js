const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Reply = require('../models/Reply');
const Analytics = require('../models/Analytics');
const { Parser } = require('json2csv');
const { appendToSheet } = require('../integrations/googleSheets');

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
// --- 2. NEW FUNCTION TO EXPORT LEADS TO GOOGLE SHEETS ---
const exportLeadsToSheet = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { spreadsheetId } = req.body; // Get Sheet ID from the request body

        if (!spreadsheetId) {
            return res.status(400).json({ success: false, error: 'Spreadsheet ID is required.' });
        }

        // Find all incoming replies that are linked to this campaign
        const campaign = await Campaign.findById(campaignId).populate('contactList');
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }
        
        // Find contacts in the campaign's list
        const contactsInList = await Contact.find({ contactList: campaign.contactList });
        const contactPhoneNumbers = contactsInList.map(c => c.phoneNumber);

        // Find replies from those contacts
        const replies = await Reply.find({ from: { $in: contactPhoneNumbers }, direction: 'incoming' })
            .populate({ path: 'from', model: Contact, select: 'name' }) // This is a bit tricky, might need adjustment
            .sort({ timestamp: 'asc' });


        if (replies.length === 0) {
            return res.status(200).json({ success: true, message: 'No replies to export for this campaign.' });
        }
        
        // Format the data for Google Sheets (an array of arrays)
        const headerRow = ['Timestamp', 'From', 'Message'];
        const dataRows = replies.map(reply => [
            new Date(reply.timestamp).toLocaleString(),
            reply.from, // This will be the phone number
            reply.body,
        ]);

        const values = [headerRow, ...dataRows];
        const range = 'Sheet1!A1'; // Assumes you want to write to the first sheet

        await appendToSheet(spreadsheetId, range, values);
        
        res.status(200).json({ success: true, message: 'Successfully exported leads to Google Sheet.' });

    } catch (error) {
        console.error('Error exporting to Google Sheets:', error);
        res.status(500).json({ success: false, error: 'Failed to export leads.' });
    }
};


module.exports = {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics,
  exportLeadsToSheet,
};