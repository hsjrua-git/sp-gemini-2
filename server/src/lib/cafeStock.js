// The moving-average cost update that completes a purchase. Prior stock is
// everything except this purchase's own movements; when nothing was left,
// the delivery's cost defines the new average — a negative leftover (sold
// before stock existed) never divides. Callers hold a lock on the touched
// product rows for the whole transaction.

export async function updateAverageCost(db, purchaseId) {
  await db.query(
    `WITH delivery AS (
       SELECT product_id,
              SUM(qty) AS qty,
              CASE WHEN SUM(qty) = 0 THEN 0
                   ELSE SUM(qty * unit_cost) / SUM(qty) END AS cost
       FROM cafe_purchase_items
       WHERE purchase_id = $1
       GROUP BY product_id
     ),
     prior AS (
       SELECT m.product_id, GREATEST(COALESCE(SUM(m.qty), 0), 0) AS stock
       FROM cafe_stock_movements m
       JOIN delivery d ON d.product_id = m.product_id
       WHERE NOT (m.kind = 'purchase' AND m.reference_id = $1)
       GROUP BY m.product_id
     )
     UPDATE cafe_products p
     SET avg_cost = GREATEST(0, round(
           CASE WHEN COALESCE(pr.stock, 0) <= 0 THEN d.cost
                ELSE (pr.stock * p.avg_cost + d.qty * d.cost)
                     / (pr.stock + d.qty)
           END
         ))::bigint
     FROM delivery d
     LEFT JOIN prior pr ON pr.product_id = d.product_id
     WHERE p.id = d.product_id`,
    [purchaseId]
  );
}
