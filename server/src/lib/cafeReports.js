// Cafe reporting aggregates over posted (non-voided) sales in a date range,
// plus the standing pictures that are always current: stock value and
// outstanding student debt. All money is bigint Toman; quantities float.

export async function getRangeReport(db, { from, to }) {
  const sales = await db.query(
    `SELECT sold_at::date::text                    AS day,
            count(*)::int                          AS "saleCount",
            COALESCE(SUM(total), 0)::bigint        AS revenue,
            COALESCE(SUM(cost_total), 0)::bigint   AS cost,
            COALESCE(SUM(total - cost_total), 0)::bigint AS profit
     FROM cafe_sales
     WHERE voided_at IS NULL
       AND sold_at >= $1::date AND sold_at < ($2::date + 1)
     GROUP BY day
     ORDER BY day DESC`,
    [from, to]
  );

  const totals = await db.query(
    `SELECT count(*)::int                                AS "saleCount",
            COALESCE(SUM(total), 0)::bigint              AS revenue,
            COALESCE(SUM(cost_total), 0)::bigint         AS cost,
            COALESCE(SUM(total - cost_total), 0)::bigint AS profit
     FROM cafe_sales
     WHERE voided_at IS NULL
       AND sold_at >= $1::date AND sold_at < ($2::date + 1)`,
    [from, to]
  );

  const topProducts = await db.query(
    `SELECT p.id,
            p.name                            AS "productName",
            COALESCE(SUM(si.qty), 0)::float8  AS qty,
            COALESCE(SUM(si.qty * si.unit_price), 0)::bigint AS revenue
     FROM cafe_sale_items si
     JOIN cafe_sales sa ON sa.id = si.sale_id AND sa.voided_at IS NULL
     JOIN cafe_products p ON p.id = si.product_id
     WHERE sa.sold_at >= $1::date AND sa.sold_at < ($2::date + 1)
     GROUP BY p.id, p.name
     ORDER BY revenue DESC, p.name
     LIMIT 10`,
    [from, to]
  );

  const purchases = await db.query(
    `SELECT COALESCE(SUM(pi.qty * pi.unit_cost), 0)::bigint AS total
     FROM cafe_purchases pu
     JOIN cafe_purchase_items pi ON pi.purchase_id = pu.id
     WHERE pu.purchased_at >= $1::date AND pu.purchased_at <= $2::date`,
    [from, to]
  );

  const waste = await db.query(
    `SELECT COALESCE(SUM(-qty * unit_cost), 0)::bigint AS value
     FROM cafe_stock_movements
     WHERE kind = 'waste'
       AND created_at >= $1::date AND created_at < ($2::date + 1)`,
    [from, to]
  );

  const standing = await db.query(
    `SELECT COALESCE(SUM(qty * avg_cost), 0)::bigint AS "inventoryValue",
            (SELECT count(*)::int FROM cafe_products WHERE is_active) AS "activeProducts"
     FROM cafe_stock`
  );

  const debt = await db.query(
    `SELECT count(*)::int                       AS "debtorCount",
            COALESCE(SUM(sb.balance), 0)::bigint AS "outstandingDebt"
     FROM student_balances sb
     JOIN students s ON s.id = sb.student_id
     WHERE s.deleted_at IS NULL AND sb.balance < 0`
  );

  return {
    range: { from, to },
    totals: {
      saleCount: totals.rows[0].saleCount,
      revenue: Number(totals.rows[0].revenue),
      cost: Number(totals.rows[0].cost),
      profit: Number(totals.rows[0].profit),
    },
    daily: sales.rows.map((row) => ({
      day: row.day,
      saleCount: row.saleCount,
      revenue: Number(row.revenue),
      cost: Number(row.cost),
      profit: Number(row.profit),
    })),
    topProducts: topProducts.rows.map((row) => ({
      id: row.id,
      productName: row.productName,
      qty: row.qty,
      revenue: Number(row.revenue),
    })),
    purchasesTotal: Number(purchases.rows[0].total),
    wasteValue: Number(waste.rows[0].value),
    inventoryValue: Number(standing.rows[0].inventoryValue),
    activeProducts: standing.rows[0].activeProducts,
    debtorCount: debt.rows[0].debtorCount,
    outstandingDebt: Number(debt.rows[0].outstandingDebt),
  };
}
