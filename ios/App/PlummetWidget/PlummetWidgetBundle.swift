import SwiftUI
import WidgetKit

@main
struct PlummetWidgetBundle: WidgetBundle {
    var body: some Widget {
        PlummetWordOfDayWidget()
        PlummetLiveActivityWidget()   // from PlummetLiveActivity folder — both targets share this bundle
    }
}
