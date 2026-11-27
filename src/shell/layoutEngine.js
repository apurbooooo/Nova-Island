const MIN_COMPACT_WIDTH = 68;
const MIN_COMPACT_HEIGHT = 18;

export function panelGeometry(panel, monitor, workArea, neighbors, calendarWidth, rtl, settings, scale) {
    // Shell centers its middle group at this point in panel-local coordinates.
    const centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
    const shellCenter = (panel.width + centerOffset) / 2;
    const offset = panel.width / 2 - shellCenter;
    const height = Math.min(settings.compactHeight * scale, Math.floor(panel.height - 4 * scale));
    if (height < MIN_COMPACT_HEIGHT * scale)
        return {reason: `panel height ${panel.height}px is too short for the compact pill`};

    // Both side groups are capped by Shell's sideWidth, even on an asymmetric work area.
    const clearance = Math.min(shellCenter - Math.max(neighbors.left, neighbors.right),
        panel.width - shellCenter - neighbors.right);
    const gap = calendarWidth > 0 ? 4 * scale : 0;
    const calendarSpace = calendarWidth + gap;
    const side = Math.ceil(Math.max(-offset + (rtl ? calendarSpace : 0),
        offset + (rtl ? 0 : calendarSpace)));
    const width = Math.min(settings.compactWidth * scale, 2 * Math.floor(clearance - side));
    if (width < MIN_COMPACT_WIDTH * scale)
        return {reason: 'panel side groups leave insufficient space for a centered pill and calendar'};

    return {geometry: {width, height, offset, calendarWidth, gap, slotWidth: width + 2 * side}};
}

export function fallbackBounds(monitor, workArea, panel, settings, scale) {
    const margin = 8 * scale;
    const left = Math.max(monitor.x, workArea.x) + margin;
    const right = Math.min(monitor.x + monitor.width, workArea.x + workArea.width) - margin;
    const width = Math.min(settings.compactWidth * scale, right - left);
    const height = Math.min(settings.compactHeight * scale, Math.floor(panel.height - 4 * scale));
    const x = Math.round(Math.max(left, Math.min(right - width, monitor.x + (monitor.width - width) / 2)));
    const y = Math.ceil(Math.max(workArea.y, panel.y + panel.height) + settings.topOffset * scale);
    const bottom = Math.min(workArea.y + workArea.height, monitor.y + monitor.height) - margin;
    if (width < MIN_COMPACT_WIDTH * scale || height < MIN_COMPACT_HEIGHT * scale || y + height > bottom)
        return null;

    return {x, y, width, height};
}

export function previewBounds(workArea, panelBottom, anchorCenter, settings, scale) {
    const margin = 8 * scale;
    const top = Math.max(workArea.y, panelBottom);
    const availableWidth = workArea.width - 2 * margin;
    const availableHeight = workArea.y + workArea.height - top - margin;
    if (availableWidth <= 0 || availableHeight <= 0)
        return null;

    const width = Math.min(availableWidth, Math.max(settings.compactWidth, settings.expandedWidth) * scale);
    const height = Math.min(availableHeight, settings.expandedHeight * scale);
    const gap = Math.min(settings.topOffset * scale, availableHeight - height);
    const preferredX = anchorCenter + settings.horizontalOffset * scale - width / 2;
    const minX = workArea.x + margin;
    const maxX = workArea.x + workArea.width - margin - width;

    return {
        x: Math.round(Math.min(maxX, Math.max(minX, preferredX))),
        y: Math.round(top + gap),
        width,
        height,
    };
}
