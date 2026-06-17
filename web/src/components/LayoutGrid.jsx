import React from 'react';

// Renders a layout's slots into a CSS grid. `renderSlot(index, areaName)`
// returns the content for each slot.
export default function LayoutGrid({ layout, renderSlot, gap = 8, className = '' }) {
  const style = {
    display: 'grid',
    gridTemplateColumns: layout.columns,
    gridTemplateRows: layout.rows,
    gridTemplateAreas: layout.areas.join(' '),
    gap: `${gap}px`,
    height: '100%',
    width: '100%',
  };
  return (
    <div style={style} className={className}>
      {layout.order.map((area, i) => (
        <div key={area} style={{ gridArea: area, minHeight: 0, minWidth: 0 }}>
          {renderSlot(i, area)}
        </div>
      ))}
    </div>
  );
}
