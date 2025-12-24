const Property = require("../models/Property");

// @desc    Get all properties
// @route   GET /api/properties
// @access  Public (or Private depending on auth)
const getProperties = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search = "",
      location = "",
      propertyType = "",
      developer = "",
      status = "all",
    } = req.query;

    // Convert to numbers
    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    // Build Query
    const query = {};

    // 1. Search (Name OR Description OR Tags)
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { tags: { $in: [new RegExp(search, "i")] } }, // Search inside tags array
      ];
    }

    // 2. Filters
    if (location) {
      query.location = { $regex: location, $options: "i" };
    }
    if (propertyType) {
      query.propertyType = { $regex: propertyType, $options: "i" };
    }
    if (developer) {
      query.developer = { $regex: developer, $options: "i" };
    }
    if (status !== "all") {
      query.isActive = status === "active";
    }

    // 3. Execute Query
    const properties = await Property.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // 4. Counts
    const total = await Property.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    // 5. Response
    res.status(200).json({
      success: true,
      count: total,
      pagination: {
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      data: properties,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new property
// @route   POST /api/properties
// @access  Private
const createProperty = async (req, res) => {
  try {
    const property = await Property.create(req.body);
    res.status(201).json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a property
// @route   PUT /api/properties/:id
// @access  Private
const updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const property = await Property.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    res.status(200).json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a property
// @route   DELETE /api/properties/:id
// @access  Private
const deleteProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const property = await Property.findByIdAndDelete(id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    res.status(200).json({ message: "Property deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProperties,
  createProperty,
  updateProperty,
  deleteProperty,
};
