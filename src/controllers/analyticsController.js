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
        const { spreadsheetId } = req.body;

        if (!spreadsheetId) {
            return res.status(400).json({ success: false, error: 'Spreadsheet ID is required.' });
        }

        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }
        
        // --- THIS IS THE CORRECTED LOGIC ---
        // 1. Find all contacts that belong to the campaign's list
        const contactsInList = await Contact.find({ contactList: campaign.contactList });
        const contactPhoneNumbers = contactsInList.map(c => c.phoneNumber);

        // 2. Find all incoming replies from those specific phone numbers
        const replies = await Reply.find({ 
            from: { $in: contactPhoneNumbers }, 
            direction: 'incoming' 
        }).sort({ timestamp: 'asc' });

        if (replies.length === 0) {
            return res.status(200).json({ success: true, message: 'No replies to export for this campaign.' });
        }
        
        // 3. Format the data for Google Sheets
        const headerRow = ['Timestamp', 'From', 'Name', 'Message'];
        const dataRows = replies.map(reply => {
            // Find the contact's name from our list
            const contact = contactsInList.find(c => c.phoneNumber === reply.from);
            return [
                new Date(reply.timestamp).toLocaleString(),
                reply.from,
                contact ? contact.name : 'Unknown', // Use the name or a fallback
                reply.body,
            ];
        });
        // --- END OF CORRECTED LOGIC ---

        const values = [headerRow, ...dataRows];
        const range = 'Sheet1!A1';

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