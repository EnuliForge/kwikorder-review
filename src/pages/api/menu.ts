// src/pages/api/menu.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  // Static sample data (you can swap to Supabase later)
  const items = [
    { id: 1, name: "Beef Burger",   description: "200g patty, chips", price: 90, stream: "food",   image_url: null },
    { id: 2, name: "Chicken Wings", description: "Sticky sauce",       price: 75, stream: "food",   image_url: null },
    { id: 3, name: "Margarita",     description: "Tequila, lime",      price: 60, stream: "drinks", image_url: null },
    { id: 4, name: "Mojito",        description: "Rum, mint, soda",    price: 55, stream: "drinks", image_url: null },
    { id: 5, name: "Veggie Wrap",   description: "Grilled veg",        price: 65, stream: "food",   image_url: null },
    { id: 6, name: "Fresh Juice",   description: "Seasonal mix",       price: 40, stream: "drinks", image_url: null },

    // ⬇️ NEW: Ribeye (the MenuItemCard will detect "ribeye" and show the configurator)
    { id: 9001, name: "Ribeye (300g)", description: "Prime ribeye with doneness & side options", price: 220, stream: "food", image_url: null },
  ];

  res.status(200).json({ items });
}
