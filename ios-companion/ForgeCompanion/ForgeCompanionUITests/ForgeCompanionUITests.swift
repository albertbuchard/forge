//
//  ForgeCompanionUITests.swift
//  ForgeCompanionUITests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest

final class ForgeCompanionUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    @MainActor
    func testMovementTimelineSelectedActionButtonsAreTappable() throws {
        let app = XCUIApplication()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "life-timeline"
        app.launch()

        XCTAssertTrue(app.staticTexts["Life Timeline"].waitForExistence(timeout: 8))

        let segmentButtons = app.buttons.matching(identifier: "MovementTimelineStaySegmentButton")
        XCTAssertTrue(segmentButtons.firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(tapFirstHittable(in: segmentButtons), "No hittable movement timeline segment was available.")

        let labelButton = app.buttons["MovementTimelineInlineLabelLocationButton"]
        if labelButton.waitForExistence(timeout: 5) == false {
            XCTFail("Inline label button did not appear after selecting a stay.\n\(app.debugDescription)")
        }
        XCTAssertTrue(labelButton.isHittable)
        labelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()

        let detailsButton = app.buttons["MovementTimelineInlineDetailsButton"]
        XCTAssertTrue(detailsButton.waitForExistence(timeout: 5))
        XCTAssertTrue(detailsButton.isHittable)
        detailsButton.tap()

        let sheetLabelButton = app.buttons["MovementTimelineDetailSheetLabelLocationButton"]
        XCTAssertTrue(sheetLabelButton.waitForExistence(timeout: 5))
        XCTAssertTrue(sheetLabelButton.isHittable)
        sheetLabelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }

    private func tapFirstHittable(in query: XCUIElementQuery) -> Bool {
        for index in 0..<min(query.count, 12) {
            let element = query.element(boundBy: index)
            if element.exists,
               element.isHittable,
               element.frame.midY > 140,
               element.frame.midY < 820
            {
                element.tap()
                return true
            }
        }
        return false
    }
}
